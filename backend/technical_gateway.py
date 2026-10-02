"""Optional real MQTT and mDNS transport for MeshMind's local Gateway process."""

from __future__ import annotations

import json
import os
import socket
import threading
import uuid
from typing import Any, Callable


class TechnicalGateway:
    def __init__(
        self,
        peer_search: Callable[[dict[str, Any]], dict[str, Any]],
        sync_processor: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> None:
        self.peer_search = peer_search
        self.sync_processor = sync_processor
        self.mqtt_host = os.environ.get("MQTT_BROKER_HOST", "").strip()
        self.mqtt_port = self._int_env("MQTT_BROKER_PORT", 1883, 1, 65535)
        self.mqtt_client_id = os.environ.get("MQTT_CLIENT_ID", "meshmind-gateway").strip() or "meshmind-gateway"
        self.mqtt_configured = bool(self.mqtt_host)
        self.mqtt_connected = False
        self.mqtt_message = "MQTT broker is not configured." if not self.mqtt_configured else "Connecting to configured MQTT broker."
        self.mqtt_error: str | None = None
        self.client: Any = None
        self._mqtt_module: Any = None
        self._lock = threading.RLock()
        self._pending: dict[str, tuple[threading.Event, dict[str, Any] | None]] = {}
        self._last_anomaly: dict[str, Any] | None = None
        self._mdns: Any = None
        self._mdns_browser: Any = None
        self._mdns_service: Any = None
        self._mdns_thread: threading.Thread | None = None
        self._mdns_stop = threading.Event()
        self._discovered: dict[str, dict[str, Any]] = {}
        self.mdns_configured = True
        self.mdns_status = "starting"
        self.mdns_message = "mDNS registration and discovery are starting in the background."
        self.mdns_error: str | None = None
        self.api_port = self._int_env("MESHMIND_API_PORT", 8000, 1, 65535)

    @staticmethod
    def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
        try:
            return max(minimum, min(int(os.environ.get(name, str(default))), maximum))
        except ValueError:
            return default

    def start(self) -> None:
        if self.mqtt_configured:
            self._start_mqtt()
        self._mdns_thread = threading.Thread(
            target=self._run_mdns, name="meshmind-mdns", daemon=True,
        )
        self._mdns_thread.start()

    def _start_mqtt(self) -> None:
        try:
            import paho.mqtt.client as mqtt
            self._mqtt_module = mqtt
        except ImportError:
            self.mqtt_message = "MQTT is configured, but dependency paho-mqtt is not installed."
            self.mqtt_error = "paho-mqtt is not installed"
            return
        try:
            try:
                client = self._mqtt_module.Client(
                    callback_api_version=self._mqtt_module.CallbackAPIVersion.VERSION2,
                    client_id=self.mqtt_client_id,
                )
            except AttributeError:
                client = self._mqtt_module.Client(client_id=self.mqtt_client_id)
            username = os.environ.get("MQTT_USERNAME", "")
            password = os.environ.get("MQTT_PASSWORD", "")
            if username:
                client.username_pw_set(username, password or None)
            client.on_connect = self._on_connect
            client.on_disconnect = self._on_disconnect
            client.on_message = self._on_message
            if hasattr(client, "on_connect_fail"):
                client.on_connect_fail = self._on_connect_fail
            self.client = client
            client.connect_async(self.mqtt_host, self.mqtt_port, keepalive=30)
            client.loop_start()
        except Exception as exc:
            self.mqtt_message = f"MQTT connection could not start: {type(exc).__name__}."
            self.mqtt_error = type(exc).__name__

    @staticmethod
    def _reason_ok(reason_code: Any) -> bool:
        return getattr(reason_code, "value", reason_code) == 0

    def _on_connect(self, client: Any, _userdata: Any, _flags: Any, reason_code: Any, *_args: Any) -> None:
        with self._lock:
            self.mqtt_connected = self._reason_ok(reason_code)
            self.mqtt_error = None if self.mqtt_connected else f"Broker refused connection ({reason_code})."
            self.mqtt_message = "Connected to the configured MQTT broker." if self.mqtt_connected else self.mqtt_error
        if self.mqtt_connected:
            client.subscribe([
                ("meshmind/machine/+/query", 1),
                ("meshmind/machine/+/anomaly", 1),
                ("meshmind/sync/request", 1),
            ])
            client.publish("meshmind/gateway/status", json.dumps({
                "service": "Gateway", "status": "connected", "client_id": self.mqtt_client_id,
            }), qos=1)

    def _on_disconnect(self, _client: Any, _userdata: Any, *args: Any) -> None:
        reason_code = args[-2] if len(args) >= 2 else (args[-1] if args else "unknown")
        with self._lock:
            self.mqtt_connected = False
            self.mqtt_error = str(reason_code)
            self.mqtt_message = f"Disconnected from MQTT broker ({reason_code})."
            for event, _ in self._pending.values():
                event.set()

    def _on_connect_fail(self, *_args: Any) -> None:
        with self._lock:
            self.mqtt_connected = False
            self.mqtt_message = f"MQTT broker unavailable at {self.mqtt_host}:{self.mqtt_port}."
            self.mqtt_error = self.mqtt_message

    def publish(self, topic: str, payload: dict[str, Any], timeout: float = 4.0) -> None:
        if not self.mqtt_configured or self.client is None or not self.mqtt_connected:
            raise RuntimeError(self.mqtt_message)
        result = self.client.publish(topic, json.dumps(payload, ensure_ascii=False), qos=1)
        if getattr(result, "rc", 0) != 0:
            raise RuntimeError(f"MQTT publish failed with result code {result.rc}.")
        result.wait_for_publish(timeout=timeout)
        if hasattr(result, "is_published") and not result.is_published():
            raise RuntimeError("MQTT publish was not acknowledged before timeout.")

    def request_machine_a(self, query: str, timeout: float = 12.0) -> dict[str, Any]:
        if not self.mqtt_configured:
            raise RuntimeError("MQTT is not configured.")
        request_id = str(uuid.uuid4())
        event = threading.Event()
        with self._lock:
            self._pending[request_id] = (event, None)
        try:
            self.publish("meshmind/machine/M-B-002/query", {
                "request_id": request_id,
                "requesting_machine_id": "M-B-002",
                "target_machine_id": "M-A-001",
                "query": query,
            })
            if not event.wait(timeout):
                raise TimeoutError("Timed out waiting for Machine A's MQTT peer response.")
            with self._lock:
                response = self._pending.get(request_id, (event, None))[1]
            if response is None:
                raise RuntimeError(self.mqtt_message or "MQTT peer response was unavailable.")
            return response
        finally:
            with self._lock:
                self._pending.pop(request_id, None)

    def _on_message(self, _client: Any, _userdata: Any, message: Any) -> None:
        try:
            payload = json.loads(message.payload.decode("utf-8"))
            if not isinstance(payload, dict):
                return
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        topic = str(message.topic)
        if topic.endswith("/response"):
            request_id = payload.get("request_id")
            with self._lock:
                pending = self._pending.get(str(request_id))
                if pending:
                    self._pending[str(request_id)] = (pending[0], payload)
                    pending[0].set()
            return
        if topic.endswith("/anomaly"):
            with self._lock:
                self._last_anomaly = payload
            return
        if topic == "meshmind/sync/request":
            if not isinstance(payload.get("request_id"), str) or len(payload["request_id"]) > 80:
                return
            threading.Thread(target=self._process_sync_message, args=(payload,), daemon=True).start()
            return
        parts = topic.split("/")
        if len(parts) == 4 and parts[:2] == ["meshmind", "machine"] and parts[3] == "query":
            self._process_peer_message(parts[2], payload)

    def _process_peer_message(self, requester_id: str, payload: dict[str, Any]) -> None:
        request_id = payload.get("request_id")
        if not isinstance(request_id, str) or len(request_id) > 80:
            return
        if requester_id != "M-B-002" or payload.get("requesting_machine_id") != requester_id:
            return
        target = payload.get("target_machine_id")
        query = payload.get("query")
        if target != "M-A-001" or not isinstance(query, str) or not query.strip() or len(query) > 2000:
            return
        try:
            result = self.peer_search({"machine_id": target, "requesting_machine_id": requester_id, "query": query.strip()})
            response = {"request_id": request_id, **result}
        except Exception as exc:
            response = {"request_id": request_id, "found": False, "error": f"Machine A peer search failed: {type(exc).__name__}."}
        try:
            self.publish(f"meshmind/machine/{requester_id}/response", response)
        except RuntimeError:
            pass

    def _process_sync_message(self, payload: dict[str, Any]) -> None:
        try:
            result = self.sync_processor(payload)
        except Exception as exc:
            result = {"status": "error", "message": f"Gateway sync request failed: {type(exc).__name__}."}
        try:
            self.publish("meshmind/sync/status", result)
        except RuntimeError:
            pass

    def publish_anomaly(self, payload: dict[str, Any]) -> None:
        if self.mqtt_connected:
            self.publish("meshmind/machine/M-B-002/anomaly", payload)

    def _run_mdns(self) -> None:
        try:
            from zeroconf import ServiceBrowser, ServiceInfo, Zeroconf
        except ImportError:
            self.mdns_status = "unavailable"
            self.mdns_message = "mDNS is unavailable because dependency zeroconf is not installed; use configured MQTT broker host/port."
            self.mdns_error = "zeroconf is not installed"
            return
        try:
            addresses = sorted({
                info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
                if info[4][0] and not info[4][0].startswith("127.")
            })
            if not addresses:
                raise OSError("No LAN IPv4 address is available for mDNS advertisement.")
            self._mdns = Zeroconf()
            service_type = "_meshmind._tcp.local."
            instance = f"MeshMind Gateway-{socket.gethostname()}.{service_type}"
            self._mdns_service = ServiceInfo(
                service_type, instance, addresses=[socket.inet_aton(addresses[0])], port=self.api_port,
                properties={"service": "meshmind", "role": "gateway", "identity": "Gateway"},
                server=f"{socket.gethostname()}.local.",
            )
            # Zeroconf is synchronous and may wait on network operations. Keep
            # registration and teardown on this worker, away from ASGI's loop.
            self._mdns.register_service(self._mdns_service)
            self._mdns_browser = ServiceBrowser(
                self._mdns, service_type, handlers=[self._on_service_change],
            )
            self.mdns_status = "available"
            self.mdns_message = "Gateway service registered and local MeshMind service discovery is active."
            self.mdns_error = None
            self._mdns_stop.wait()
        except Exception as exc:
            self.mdns_status = "unavailable"
            self.mdns_error = f"{type(exc).__name__}: {exc}"
            self.mdns_message = f"mDNS registration/discovery failed: {type(exc).__name__}; use configured MQTT broker host/port."
        finally:
            if self._mdns is not None:
                try:
                    if self._mdns_service is not None and self.mdns_status == "available":
                        self._mdns.unregister_service(self._mdns_service)
                    self._mdns.close()
                except Exception as exc:
                    self.mdns_error = f"{type(exc).__name__}: {exc}"
                    self.mdns_status = "unavailable"
                    self.mdns_message = f"mDNS shutdown failed: {type(exc).__name__}."
                finally:
                    self._mdns = None

    def _on_service_change(self, zeroconf: Any, service_type: str, name: str, state_change: Any) -> None:
        try:
            from zeroconf import ServiceStateChange
            if state_change == ServiceStateChange.Removed:
                with self._lock:
                    self._discovered.pop(name, None)
                return
            info = zeroconf.get_service_info(service_type, name, timeout=1500)
            if info is None:
                return
            addresses = [socket.inet_ntoa(address) for address in info.addresses if len(address) == 4]
            record = {
                "name": name, "host": info.server.rstrip("."), "port": info.port,
                "addresses": addresses,
                "identity": str(info.properties.get(b"identity", b"").decode("utf-8", errors="ignore")),
            }
            with self._lock:
                self._discovered[name] = record
        except Exception:
            return

    def status(self) -> dict[str, Any]:
        with self._lock:
            services = list(self._discovered.values())
            return {
                "gateway": {"status": "ready", "component": "MeshMind backend Gateway process"},
                "mqtt": {
                    "configured": self.mqtt_configured,
                    "status": "connected" if self.mqtt_connected else ("disconnected" if self.mqtt_configured else "not_configured"),
                    "connected": self.mqtt_connected, "host": self.mqtt_host or None,
                    "port": self.mqtt_port if self.mqtt_configured else None,
                    "client_id": self.mqtt_client_id, "message": self.mqtt_message,
                    "last_anomaly_event": self._last_anomaly,
                },
                "mdns": {
                    "configured": self.mdns_configured,
                    "status": self.mdns_status, "available": self.mdns_status == "available",
                    "message": self.mdns_message, "error": self.mdns_error,
                    "service_name": getattr(self._mdns_service, "name", None),
                    "services": services,
                    "fallback": {"host": self.mqtt_host or None, "port": self.mqtt_port if self.mqtt_configured else None},
                },
            }

    def close(self) -> None:
        if self.client is not None:
            try:
                self.client.disconnect()
                self.client.loop_stop()
            except Exception:
                pass
        self._mdns_stop.set()
