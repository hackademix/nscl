
"use strict";
try {
  let BASE = "/nscl/";
  self.include = src => Array.isArray(src) ? importScripts(...src) : importScripts(src);
  
  let includeFrom = (dir, srcs) =>  include(srcs.map(name => `${BASE}/${dir}/${name}.js`));
  
  includeFrom("lib", [
    "browser-polyfill", "punycode", "sha256"
  ]);
  
 
  includeFrom("common", [
    "UA", "uuid", "log", "locale",
    "tld", "Messages",
    "CSP", "CapsCSP", "NetCSP",
    "RequestKey", "Policy",
    "Storage",
  ]);

  includeFrom("service", [
    "TabCache"
  ]);
} catch (e) {
  console.error(e);
}
