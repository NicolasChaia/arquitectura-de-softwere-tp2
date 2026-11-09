import http from "node:http";
http.createServer((q, s) => { q.resume(); q.on("end", () => { s.setHeader("content-type", "application/json"); s.end('{"ok":true}'); }); }).listen(5600);
