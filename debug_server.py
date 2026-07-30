#!/usr/bin/env python3
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LOG_PATH = Path("/opt/cursor/logs/debug.log")


class DebugRequestHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/__debug_log":
            self.send_error(404)
            return

        try:
            content_length = min(int(self.headers.get("Content-Length", "0")), 65_536)
            payload = json.loads(self.rfile.read(content_length))
            if not isinstance(payload, dict):
                raise ValueError("debug payload must be an object")
            # region agent log
            with LOG_PATH.open("a", encoding="utf-8") as log_file:
                log_file.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
            # endregion
        except (ValueError, json.JSONDecodeError):
            self.send_error(400)
            return

        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    handler = partial(DebugRequestHandler, directory=str(ROOT))
    ThreadingHTTPServer(("127.0.0.1", 5173), handler).serve_forever()
