"""
2D Virtual Dev Office - Multithreaded Python Web Server
Handles multiple parallel HTTP connections without blocking or hanging on keep-alive sockets.
"""

import http.server
import socketserver
import os
import sys

PORT = 3000
HOST = "0.0.0.0"

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)

    try:
        with ThreadedHTTPServer((HOST, PORT), CustomHandler) as httpd:
            print("==============================================================")
            print("  🏢 2D Virtual Dev Office & Sprint Manager - Python Server")
            print("==============================================================")
            print(f"\n  Server aktif di:")
            print(f"  ➔ http://localhost:{PORT}")
            print(f"  ➔ http://127.0.0.1:{PORT}")
            print("\n  Tekan Ctrl + C untuk menghentikan server.\n")
            httpd.serve_forever()
    except OSError as e:
        if "address already in use" in str(e).lower() or e.errno == 98 or e.errno == 10048:
            print(f"\n⚠ Port {PORT} sudah digunakan oleh proses lain.")
            print(f"Silakan buka http://localhost:{PORT} atau tutup proses lama.")
        else:
            raise
