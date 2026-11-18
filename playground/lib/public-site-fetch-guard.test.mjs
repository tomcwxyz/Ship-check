import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { publicIPv4, allowedUrl, selectAddress } = require("./public-site-fetch-guard.cjs");

test("connection-time DNS pinning refuses private, reserved, mapped and link-local addresses",()=>{
  for(const address of ["127.0.0.1","10.0.0.1","172.16.4.1","192.168.2.3",
    "169.254.169.254","100.64.0.1","0.0.0.0","224.0.0.2","192.0.2.1",
    "198.51.100.5","203.0.113.10","8.8.8.8.8","::ffff:127.0.0.1"]) {
    assert.equal(publicIPv4(address),false,address);
    assert.throws(()=>selectAddress([{address,family:address.includes(":")?6:4}]),undefined,address);
  }
  assert.equal(publicIPv4("1.1.1.1"),true);
  assert.equal(selectAddress([{address:"1.1.1.1",family:4}]),"1.1.1.1");
});

test("mixed DNS records fail closed, rather than choosing a convenient public A record",()=>{
  assert.throws(()=>selectAddress([{address:"1.1.1.1",family:4},{address:"10.0.0.12",family:4}]));
  assert.throws(()=>selectAddress([{address:"1.1.1.1",family:4},{address:"::1",family:6}]));
  assert.throws(()=>selectAddress([{address:"1.1.1.1",family:4},{address:"fd00::1234",family:6}]));
  assert.throws(()=>selectAddress([{address:"1.1.1.1",family:4},{address:"fe80::1",family:6}]));
  assert.throws(()=>selectAddress([{address:"2606:4700:4700::1111",family:6}]));
  assert.equal(selectAddress([{address:"1.1.1.1",family:4},{address:"2606:4700:4700::1111",family:6}]),"1.1.1.1");
});

test("runtime connections are HTTPS-only, same-host and credential-free",()=>{
  assert.equal(allowedUrl("https://www.example.org/about", "www.example.org").pathname,"/about");
  for(const input of [
    "http://www.example.org","https://www.example.org:8443",
    "https://user:pass@www.example.org","https://127.0.0.1",
    "https://www.example.org.evil.test","https://another.example.org",
    "file:///etc/passwd","https://[::1]/"
  ]) assert.throws(()=>allowedUrl(input,"www.example.org"),undefined,input);
});

test("runtime requests do not allow custom request methods or automatic redirects", async()=>{
  const { publicSiteFetch }=require("./public-site-fetch-guard.cjs");
  await assert.rejects(()=>publicSiteFetch("https://www.example.org/",{method:"POST",redirect:"manual"},"www.example.org"));
  await assert.rejects(()=>publicSiteFetch("https://www.example.org/",{method:"GET",redirect:"follow"},"www.example.org"));
  await assert.rejects(()=>publicSiteFetch("https://other.example.org/",{method:"GET",redirect:"manual"},"www.example.org"));
});
