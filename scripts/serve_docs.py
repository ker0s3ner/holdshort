import functools
import http.server
import os

docs_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=docs_dir)
http.server.ThreadingHTTPServer(("127.0.0.1", 8787), handler).serve_forever()
