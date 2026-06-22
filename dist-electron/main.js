var bc = Object.defineProperty;
var Pc = (e, t, r) => t in e ? bc(e, t, { enumerable: !0, configurable: !0, writable: !0, value: r }) : e[t] = r;
var Kt = (e, t, r) => (Pc(e, typeof t != "symbol" ? t + "" : t, r), r), _n = (e, t, r) => {
  if (!t.has(e))
    throw TypeError("Cannot " + r);
};
var x = (e, t, r) => (_n(e, t, "read from private field"), r ? r.call(e) : t.get(e)), le = (e, t, r) => {
  if (t.has(e))
    throw TypeError("Cannot add the same private member more than once");
  t instanceof WeakSet ? t.add(e) : t.set(e, r);
}, be = (e, t, r, n) => (_n(e, t, "write to private field"), n ? n.call(e, r) : t.set(e, r), r);
var Ge = (e, t, r) => (_n(e, t, "access private method"), r);
import ss, { ipcMain as ct, app as xe, BrowserWindow as as, dialog as _a, Menu as Rc, nativeImage as Oc } from "electron";
import Fo from "path";
import os from "fs";
import Ic from "constants";
import Nc from "stream";
import Tc from "util";
import jc from "assert";
import { fileURLToPath as Ac } from "node:url";
import H from "node:path";
import se from "node:process";
import { promisify as pe, isDeepStrictEqual as Ea } from "node:util";
import B from "node:fs";
import Ht from "node:crypto";
import wa from "node:assert";
import Vo from "node:os";
import "node:events";
import "node:stream";
var En = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : {};
function is(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, "default") ? e.default : e;
}
var wn, Sa;
function kc() {
  if (Sa)
    return wn;
  Sa = 1;
  var e = Ic, t = process.cwd, r = null, n = process.env.GRACEFUL_FS_PLATFORM || process.platform;
  process.cwd = function() {
    return r || (r = t.call(process)), r;
  };
  try {
    process.cwd();
  } catch {
  }
  if (typeof process.chdir == "function") {
    var s = process.chdir;
    process.chdir = function(o) {
      r = null, s.call(process, o);
    }, Object.setPrototypeOf && Object.setPrototypeOf(process.chdir, s);
  }
  wn = a;
  function a(o) {
    e.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./) && u(o), o.lutimes || i(o), o.chown = p(o.chown), o.fchown = p(o.fchown), o.lchown = p(o.lchown), o.chmod = f(o.chmod), o.fchmod = f(o.fchmod), o.lchmod = f(o.lchmod), o.chownSync = w(o.chownSync), o.fchownSync = w(o.fchownSync), o.lchownSync = w(o.lchownSync), o.chmodSync = c(o.chmodSync), o.fchmodSync = c(o.fchmodSync), o.lchmodSync = c(o.lchmodSync), o.stat = y(o.stat), o.fstat = y(o.fstat), o.lstat = y(o.lstat), o.statSync = b(o.statSync), o.fstatSync = b(o.fstatSync), o.lstatSync = b(o.lstatSync), o.chmod && !o.lchmod && (o.lchmod = function(d, m, $) {
      $ && process.nextTick($);
    }, o.lchmodSync = function() {
    }), o.chown && !o.lchown && (o.lchown = function(d, m, $, P) {
      P && process.nextTick(P);
    }, o.lchownSync = function() {
    }), n === "win32" && (o.rename = typeof o.rename != "function" ? o.rename : function(d) {
      function m($, P, R) {
        var I = Date.now(), T = 0;
        d($, P, function V(J) {
          if (J && (J.code === "EACCES" || J.code === "EPERM" || J.code === "EBUSY") && Date.now() - I < 6e4) {
            setTimeout(function() {
              o.stat(P, function(ae, de) {
                ae && ae.code === "ENOENT" ? d($, P, V) : R(J);
              });
            }, T), T < 100 && (T += 10);
            return;
          }
          R && R(J);
        });
      }
      return Object.setPrototypeOf && Object.setPrototypeOf(m, d), m;
    }(o.rename)), o.read = typeof o.read != "function" ? o.read : function(d) {
      function m($, P, R, I, T, V) {
        var J;
        if (V && typeof V == "function") {
          var ae = 0;
          J = function(de, M, G) {
            if (de && de.code === "EAGAIN" && ae < 10)
              return ae++, d.call(o, $, P, R, I, T, J);
            V.apply(this, arguments);
          };
        }
        return d.call(o, $, P, R, I, T, J);
      }
      return Object.setPrototypeOf && Object.setPrototypeOf(m, d), m;
    }(o.read), o.readSync = typeof o.readSync != "function" ? o.readSync : function(d) {
      return function(m, $, P, R, I) {
        for (var T = 0; ; )
          try {
            return d.call(o, m, $, P, R, I);
          } catch (V) {
            if (V.code === "EAGAIN" && T < 10) {
              T++;
              continue;
            }
            throw V;
          }
      };
    }(o.readSync);
    function u(d) {
      d.lchmod = function(m, $, P) {
        d.open(
          m,
          e.O_WRONLY | e.O_SYMLINK,
          $,
          function(R, I) {
            if (R) {
              P && P(R);
              return;
            }
            d.fchmod(I, $, function(T) {
              d.close(I, function(V) {
                P && P(T || V);
              });
            });
          }
        );
      }, d.lchmodSync = function(m, $) {
        var P = d.openSync(m, e.O_WRONLY | e.O_SYMLINK, $), R = !0, I;
        try {
          I = d.fchmodSync(P, $), R = !1;
        } finally {
          if (R)
            try {
              d.closeSync(P);
            } catch {
            }
          else
            d.closeSync(P);
        }
        return I;
      };
    }
    function i(d) {
      e.hasOwnProperty("O_SYMLINK") && d.futimes ? (d.lutimes = function(m, $, P, R) {
        d.open(m, e.O_SYMLINK, function(I, T) {
          if (I) {
            R && R(I);
            return;
          }
          d.futimes(T, $, P, function(V) {
            d.close(T, function(J) {
              R && R(V || J);
            });
          });
        });
      }, d.lutimesSync = function(m, $, P) {
        var R = d.openSync(m, e.O_SYMLINK), I, T = !0;
        try {
          I = d.futimesSync(R, $, P), T = !1;
        } finally {
          if (T)
            try {
              d.closeSync(R);
            } catch {
            }
          else
            d.closeSync(R);
        }
        return I;
      }) : d.futimes && (d.lutimes = function(m, $, P, R) {
        R && process.nextTick(R);
      }, d.lutimesSync = function() {
      });
    }
    function f(d) {
      return d && function(m, $, P) {
        return d.call(o, m, $, function(R) {
          _(R) && (R = null), P && P.apply(this, arguments);
        });
      };
    }
    function c(d) {
      return d && function(m, $) {
        try {
          return d.call(o, m, $);
        } catch (P) {
          if (!_(P))
            throw P;
        }
      };
    }
    function p(d) {
      return d && function(m, $, P, R) {
        return d.call(o, m, $, P, function(I) {
          _(I) && (I = null), R && R.apply(this, arguments);
        });
      };
    }
    function w(d) {
      return d && function(m, $, P) {
        try {
          return d.call(o, m, $, P);
        } catch (R) {
          if (!_(R))
            throw R;
        }
      };
    }
    function y(d) {
      return d && function(m, $, P) {
        typeof $ == "function" && (P = $, $ = null);
        function R(I, T) {
          T && (T.uid < 0 && (T.uid += 4294967296), T.gid < 0 && (T.gid += 4294967296)), P && P.apply(this, arguments);
        }
        return $ ? d.call(o, m, $, R) : d.call(o, m, R);
      };
    }
    function b(d) {
      return d && function(m, $) {
        var P = $ ? d.call(o, m, $) : d.call(o, m);
        return P && (P.uid < 0 && (P.uid += 4294967296), P.gid < 0 && (P.gid += 4294967296)), P;
      };
    }
    function _(d) {
      if (!d || d.code === "ENOSYS")
        return !0;
      var m = !process.getuid || process.getuid() !== 0;
      return !!(m && (d.code === "EINVAL" || d.code === "EPERM"));
    }
  }
  return wn;
}
var Sn, ba;
function Cc() {
  if (ba)
    return Sn;
  ba = 1;
  var e = Nc.Stream;
  Sn = t;
  function t(r) {
    return {
      ReadStream: n,
      WriteStream: s
    };
    function n(a, o) {
      if (!(this instanceof n))
        return new n(a, o);
      e.call(this);
      var u = this;
      this.path = a, this.fd = null, this.readable = !0, this.paused = !1, this.flags = "r", this.mode = 438, this.bufferSize = 64 * 1024, o = o || {};
      for (var i = Object.keys(o), f = 0, c = i.length; f < c; f++) {
        var p = i[f];
        this[p] = o[p];
      }
      if (this.encoding && this.setEncoding(this.encoding), this.start !== void 0) {
        if (typeof this.start != "number")
          throw TypeError("start must be a Number");
        if (this.end === void 0)
          this.end = 1 / 0;
        else if (typeof this.end != "number")
          throw TypeError("end must be a Number");
        if (this.start > this.end)
          throw new Error("start must be <= end");
        this.pos = this.start;
      }
      if (this.fd !== null) {
        process.nextTick(function() {
          u._read();
        });
        return;
      }
      r.open(this.path, this.flags, this.mode, function(w, y) {
        if (w) {
          u.emit("error", w), u.readable = !1;
          return;
        }
        u.fd = y, u.emit("open", y), u._read();
      });
    }
    function s(a, o) {
      if (!(this instanceof s))
        return new s(a, o);
      e.call(this), this.path = a, this.fd = null, this.writable = !0, this.flags = "w", this.encoding = "binary", this.mode = 438, this.bytesWritten = 0, o = o || {};
      for (var u = Object.keys(o), i = 0, f = u.length; i < f; i++) {
        var c = u[i];
        this[c] = o[c];
      }
      if (this.start !== void 0) {
        if (typeof this.start != "number")
          throw TypeError("start must be a Number");
        if (this.start < 0)
          throw new Error("start must be >= zero");
        this.pos = this.start;
      }
      this.busy = !1, this._queue = [], this.fd === null && (this._open = r.open, this._queue.push([this._open, this.path, this.flags, this.mode, void 0]), this.flush());
    }
  }
  return Sn;
}
var bn, Pa;
function Dc() {
  if (Pa)
    return bn;
  Pa = 1, bn = t;
  var e = Object.getPrototypeOf || function(r) {
    return r.__proto__;
  };
  function t(r) {
    if (r === null || typeof r != "object")
      return r;
    if (r instanceof Object)
      var n = { __proto__: e(r) };
    else
      var n = /* @__PURE__ */ Object.create(null);
    return Object.getOwnPropertyNames(r).forEach(function(s) {
      Object.defineProperty(n, s, Object.getOwnPropertyDescriptor(r, s));
    }), n;
  }
  return bn;
}
var cr, Ra;
function Lc() {
  if (Ra)
    return cr;
  Ra = 1;
  var e = os, t = kc(), r = Cc(), n = Dc(), s = Tc, a, o;
  typeof Symbol == "function" && typeof Symbol.for == "function" ? (a = Symbol.for("graceful-fs.queue"), o = Symbol.for("graceful-fs.previous")) : (a = "___graceful-fs.queue", o = "___graceful-fs.previous");
  function u() {
  }
  function i(d, m) {
    Object.defineProperty(d, a, {
      get: function() {
        return m;
      }
    });
  }
  var f = u;
  if (s.debuglog ? f = s.debuglog("gfs4") : /\bgfs4\b/i.test(process.env.NODE_DEBUG || "") && (f = function() {
    var d = s.format.apply(s, arguments);
    d = "GFS4: " + d.split(/\n/).join(`
GFS4: `), console.error(d);
  }), !e[a]) {
    var c = En[a] || [];
    i(e, c), e.close = function(d) {
      function m($, P) {
        return d.call(e, $, function(R) {
          R || b(), typeof P == "function" && P.apply(this, arguments);
        });
      }
      return Object.defineProperty(m, o, {
        value: d
      }), m;
    }(e.close), e.closeSync = function(d) {
      function m($) {
        d.apply(e, arguments), b();
      }
      return Object.defineProperty(m, o, {
        value: d
      }), m;
    }(e.closeSync), /\bgfs4\b/i.test(process.env.NODE_DEBUG || "") && process.on("exit", function() {
      f(e[a]), jc.equal(e[a].length, 0);
    });
  }
  En[a] || i(En, e[a]), cr = p(n(e)), process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !e.__patched && (cr = p(e), e.__patched = !0);
  function p(d) {
    t(d), d.gracefulify = p, d.createReadStream = g, d.createWriteStream = S;
    var m = d.readFile;
    d.readFile = $;
    function $(h, E, N) {
      return typeof E == "function" && (N = E, E = null), j(h, E, N);
      function j(F, z, W, ee) {
        return m(F, z, function(Q) {
          Q && (Q.code === "EMFILE" || Q.code === "ENFILE") ? w([j, [F, z, W], Q, ee || Date.now(), Date.now()]) : typeof W == "function" && W.apply(this, arguments);
        });
      }
    }
    var P = d.writeFile;
    d.writeFile = R;
    function R(h, E, N, j) {
      return typeof N == "function" && (j = N, N = null), F(h, E, N, j);
      function F(z, W, ee, Q, ie) {
        return P(z, W, ee, function(te) {
          te && (te.code === "EMFILE" || te.code === "ENFILE") ? w([F, [z, W, ee, Q], te, ie || Date.now(), Date.now()]) : typeof Q == "function" && Q.apply(this, arguments);
        });
      }
    }
    var I = d.appendFile;
    I && (d.appendFile = T);
    function T(h, E, N, j) {
      return typeof N == "function" && (j = N, N = null), F(h, E, N, j);
      function F(z, W, ee, Q, ie) {
        return I(z, W, ee, function(te) {
          te && (te.code === "EMFILE" || te.code === "ENFILE") ? w([F, [z, W, ee, Q], te, ie || Date.now(), Date.now()]) : typeof Q == "function" && Q.apply(this, arguments);
        });
      }
    }
    var V = d.copyFile;
    V && (d.copyFile = J);
    function J(h, E, N, j) {
      return typeof N == "function" && (j = N, N = 0), F(h, E, N, j);
      function F(z, W, ee, Q, ie) {
        return V(z, W, ee, function(te) {
          te && (te.code === "EMFILE" || te.code === "ENFILE") ? w([F, [z, W, ee, Q], te, ie || Date.now(), Date.now()]) : typeof Q == "function" && Q.apply(this, arguments);
        });
      }
    }
    var ae = d.readdir;
    d.readdir = M;
    var de = /^v[0-5]\./;
    function M(h, E, N) {
      typeof E == "function" && (N = E, E = null);
      var j = de.test(process.version) ? function(W, ee, Q, ie) {
        return ae(W, F(
          W,
          ee,
          Q,
          ie
        ));
      } : function(W, ee, Q, ie) {
        return ae(W, ee, F(
          W,
          ee,
          Q,
          ie
        ));
      };
      return j(h, E, N);
      function F(z, W, ee, Q) {
        return function(ie, te) {
          ie && (ie.code === "EMFILE" || ie.code === "ENFILE") ? w([
            j,
            [z, W, ee],
            ie,
            Q || Date.now(),
            Date.now()
          ]) : (te && te.sort && te.sort(), typeof ee == "function" && ee.call(this, ie, te));
        };
      }
    }
    if (process.version.substr(0, 4) === "v0.8") {
      var G = r(d);
      k = G.ReadStream, D = G.WriteStream;
    }
    var Z = d.ReadStream;
    Z && (k.prototype = Object.create(Z.prototype), k.prototype.open = A);
    var K = d.WriteStream;
    K && (D.prototype = Object.create(K.prototype), D.prototype.open = O), Object.defineProperty(d, "ReadStream", {
      get: function() {
        return k;
      },
      set: function(h) {
        k = h;
      },
      enumerable: !0,
      configurable: !0
    }), Object.defineProperty(d, "WriteStream", {
      get: function() {
        return D;
      },
      set: function(h) {
        D = h;
      },
      enumerable: !0,
      configurable: !0
    });
    var oe = k;
    Object.defineProperty(d, "FileReadStream", {
      get: function() {
        return oe;
      },
      set: function(h) {
        oe = h;
      },
      enumerable: !0,
      configurable: !0
    });
    var Se = D;
    Object.defineProperty(d, "FileWriteStream", {
      get: function() {
        return Se;
      },
      set: function(h) {
        Se = h;
      },
      enumerable: !0,
      configurable: !0
    });
    function k(h, E) {
      return this instanceof k ? (Z.apply(this, arguments), this) : k.apply(Object.create(k.prototype), arguments);
    }
    function A() {
      var h = this;
      l(h.path, h.flags, h.mode, function(E, N) {
        E ? (h.autoClose && h.destroy(), h.emit("error", E)) : (h.fd = N, h.emit("open", N), h.read());
      });
    }
    function D(h, E) {
      return this instanceof D ? (K.apply(this, arguments), this) : D.apply(Object.create(D.prototype), arguments);
    }
    function O() {
      var h = this;
      l(h.path, h.flags, h.mode, function(E, N) {
        E ? (h.destroy(), h.emit("error", E)) : (h.fd = N, h.emit("open", N));
      });
    }
    function g(h, E) {
      return new d.ReadStream(h, E);
    }
    function S(h, E) {
      return new d.WriteStream(h, E);
    }
    var v = d.open;
    d.open = l;
    function l(h, E, N, j) {
      return typeof N == "function" && (j = N, N = null), F(h, E, N, j);
      function F(z, W, ee, Q, ie) {
        return v(z, W, ee, function(te, ir) {
          te && (te.code === "EMFILE" || te.code === "ENFILE") ? w([F, [z, W, ee, Q], te, ie || Date.now(), Date.now()]) : typeof Q == "function" && Q.apply(this, arguments);
        });
      }
    }
    return d;
  }
  function w(d) {
    f("ENQUEUE", d[0].name, d[1]), e[a].push(d), _();
  }
  var y;
  function b() {
    for (var d = Date.now(), m = 0; m < e[a].length; ++m)
      e[a][m].length > 2 && (e[a][m][3] = d, e[a][m][4] = d);
    _();
  }
  function _() {
    if (clearTimeout(y), y = void 0, e[a].length !== 0) {
      var d = e[a].shift(), m = d[0], $ = d[1], P = d[2], R = d[3], I = d[4];
      if (R === void 0)
        f("RETRY", m.name, $), m.apply(null, $);
      else if (Date.now() - R >= 6e4) {
        f("TIMEOUT", m.name, $);
        var T = $.pop();
        typeof T == "function" && T.call(null, P);
      } else {
        var V = Date.now() - I, J = Math.max(I - R, 1), ae = Math.min(J * 1.2, 100);
        V >= ae ? (f("RETRY", m.name, $), m.apply(null, $.concat([R]))) : e[a].push(d);
      }
      y === void 0 && (y = setTimeout(_, 0));
    }
  }
  return cr;
}
var Dt;
try {
  Dt = Lc();
} catch {
  Dt = os;
}
function Mc(e, t, r) {
  r == null && (r = t, t = {}), typeof t == "string" && (t = { encoding: t }), t = t || {};
  var n = t.fs || Dt, s = !0;
  "throws" in t && (s = t.throws), n.readFile(e, t, function(a, o) {
    if (a)
      return r(a);
    o = Uo(o);
    var u;
    try {
      u = JSON.parse(o, t ? t.reviver : null);
    } catch (i) {
      return s ? (i.message = e + ": " + i.message, r(i)) : r(null, null);
    }
    r(null, u);
  });
}
function Fc(e, t) {
  t = t || {}, typeof t == "string" && (t = { encoding: t });
  var r = t.fs || Dt, n = !0;
  "throws" in t && (n = t.throws);
  try {
    var s = r.readFileSync(e, t);
    return s = Uo(s), JSON.parse(s, t.reviver);
  } catch (a) {
    if (n)
      throw a.message = e + ": " + a.message, a;
    return null;
  }
}
function zo(e, t) {
  var r, n = `
`;
  typeof t == "object" && t !== null && (t.spaces && (r = t.spaces), t.EOL && (n = t.EOL));
  var s = JSON.stringify(e, t ? t.replacer : null, r);
  return s.replace(/\n/g, n) + n;
}
function Vc(e, t, r, n) {
  n == null && (n = r, r = {}), r = r || {};
  var s = r.fs || Dt, a = "";
  try {
    a = zo(t, r);
  } catch (o) {
    n && n(o, null);
    return;
  }
  s.writeFile(e, a, r, n);
}
function zc(e, t, r) {
  r = r || {};
  var n = r.fs || Dt, s = zo(t, r);
  return n.writeFileSync(e, s, r);
}
function Uo(e) {
  return Buffer.isBuffer(e) && (e = e.toString("utf8")), e = e.replace(/^\uFEFF/, ""), e;
}
var Uc = {
  readFile: Mc,
  readFileSync: Fc,
  writeFile: Vc,
  writeFileSync: zc
}, Gc = Uc, Yt = Fo, Go = os, qo = parseInt("0777", 8), qc = jt.mkdirp = jt.mkdirP = jt;
function jt(e, t, r, n) {
  typeof t == "function" ? (r = t, t = {}) : (!t || typeof t != "object") && (t = { mode: t });
  var s = t.mode, a = t.fs || Go;
  s === void 0 && (s = qo), n || (n = null);
  var o = r || /* istanbul ignore next */
  function() {
  };
  e = Yt.resolve(e), a.mkdir(e, s, function(u) {
    if (!u)
      return n = n || e, o(null, n);
    switch (u.code) {
      case "ENOENT":
        if (Yt.dirname(e) === e)
          return o(u);
        jt(Yt.dirname(e), t, function(i, f) {
          i ? o(i, f) : jt(e, t, o, f);
        });
        break;
      default:
        a.stat(e, function(i, f) {
          i || !f.isDirectory() ? o(u, n) : o(null, n);
        });
        break;
    }
  });
}
jt.sync = function e(t, r, n) {
  (!r || typeof r != "object") && (r = { mode: r });
  var s = r.mode, a = r.fs || Go;
  s === void 0 && (s = qo), n || (n = null), t = Yt.resolve(t);
  try {
    a.mkdirSync(t, s), n = n || t;
  } catch (u) {
    switch (u.code) {
      case "ENOENT":
        n = e(Yt.dirname(t), r, n), e(t, r, n);
        break;
      default:
        var o;
        try {
          o = a.statSync(t);
        } catch {
          throw u;
        }
        if (!o.isDirectory())
          throw u;
        break;
    }
  }
  return n;
};
const Oa = Fo, ur = ss, Ia = Gc, Kc = qc;
var Hc = function(e) {
  const t = ur.app || ur.remote.app, r = ur.screen || ur.remote.screen;
  let n, s, a;
  const o = 100, u = Object.assign({
    file: "window-state.json",
    path: t.getPath("userData"),
    maximize: !0,
    fullScreen: !0
  }, e), i = Oa.join(u.path, u.file);
  function f(T) {
    return !T.isMaximized() && !T.isMinimized() && !T.isFullScreen();
  }
  function c() {
    return n && Number.isInteger(n.x) && Number.isInteger(n.y) && Number.isInteger(n.width) && n.width > 0 && Number.isInteger(n.height) && n.height > 0;
  }
  function p() {
    const T = r.getPrimaryDisplay().bounds;
    n = {
      width: u.defaultWidth || 800,
      height: u.defaultHeight || 600,
      x: 0,
      y: 0,
      displayBounds: T
    };
  }
  function w(T) {
    return n.x >= T.x && n.y >= T.y && n.x + n.width <= T.x + T.width && n.y + n.height <= T.y + T.height;
  }
  function y() {
    if (!r.getAllDisplays().some((V) => w(V.bounds)))
      return p();
  }
  function b() {
    if (!(n && (c() || n.isMaximized || n.isFullScreen))) {
      n = null;
      return;
    }
    c() && n.displayBounds && y();
  }
  function _(T) {
    if (T = T || s, !!T)
      try {
        const V = T.getBounds();
        f(T) && (n.x = V.x, n.y = V.y, n.width = V.width, n.height = V.height), n.isMaximized = T.isMaximized(), n.isFullScreen = T.isFullScreen(), n.displayBounds = r.getDisplayMatching(V).bounds;
      } catch {
      }
  }
  function d(T) {
    T && _(T);
    try {
      Kc.sync(Oa.dirname(i)), Ia.writeFileSync(i, n);
    } catch {
    }
  }
  function m() {
    clearTimeout(a), a = setTimeout(_, o);
  }
  function $() {
    _();
  }
  function P() {
    I(), d();
  }
  function R(T) {
    u.maximize && n.isMaximized && T.maximize(), u.fullScreen && n.isFullScreen && T.setFullScreen(!0), T.on("resize", m), T.on("move", m), T.on("close", $), T.on("closed", P), s = T;
  }
  function I() {
    s && (s.removeListener("resize", m), s.removeListener("move", m), clearTimeout(a), s.removeListener("close", $), s.removeListener("closed", P), s = null);
  }
  try {
    n = Ia.readFileSync(i);
  } catch {
  }
  return b(), n = Object.assign({
    width: u.defaultWidth || 800,
    height: u.defaultHeight || 600
  }, n), {
    get x() {
      return n.x;
    },
    get y() {
      return n.y;
    },
    get width() {
      return n.width;
    },
    get height() {
      return n.height;
    },
    get displayBounds() {
      return n.displayBounds;
    },
    get isMaximized() {
      return n.isMaximized;
    },
    get isFullScreen() {
      return n.isFullScreen;
    },
    saveState: d,
    unmanage: I,
    manage: R,
    resetStateToDefault: p
  };
};
const Wc = /* @__PURE__ */ is(Hc), $t = (e) => {
  const t = typeof e;
  return e !== null && (t === "object" || t === "function");
}, Ko = /* @__PURE__ */ new Set([
  "__proto__",
  "prototype",
  "constructor"
]), Ho = 1e6, xc = (e) => e >= "0" && e <= "9";
function Wo(e) {
  if (e === "0")
    return !0;
  if (/^[1-9]\d*$/.test(e)) {
    const t = Number.parseInt(e, 10);
    return t <= Number.MAX_SAFE_INTEGER && t <= Ho;
  }
  return !1;
}
function Pn(e, t) {
  return Ko.has(e) ? !1 : (e && Wo(e) ? t.push(Number.parseInt(e, 10)) : t.push(e), !0);
}
function Bc(e) {
  if (typeof e != "string")
    throw new TypeError(`Expected a string, got ${typeof e}`);
  const t = [];
  let r = "", n = "start", s = !1, a = 0;
  for (const o of e) {
    if (a++, s) {
      r += o, s = !1;
      continue;
    }
    if (o === "\\") {
      if (n === "index")
        throw new Error(`Invalid character '${o}' in an index at position ${a}`);
      if (n === "indexEnd")
        throw new Error(`Invalid character '${o}' after an index at position ${a}`);
      s = !0, n = n === "start" ? "property" : n;
      continue;
    }
    switch (o) {
      case ".": {
        if (n === "index")
          throw new Error(`Invalid character '${o}' in an index at position ${a}`);
        if (n === "indexEnd") {
          n = "property";
          break;
        }
        if (!Pn(r, t))
          return [];
        r = "", n = "property";
        break;
      }
      case "[": {
        if (n === "index")
          throw new Error(`Invalid character '${o}' in an index at position ${a}`);
        if (n === "indexEnd") {
          n = "index";
          break;
        }
        if (n === "property" || n === "start") {
          if ((r || n === "property") && !Pn(r, t))
            return [];
          r = "";
        }
        n = "index";
        break;
      }
      case "]": {
        if (n === "index") {
          if (r === "")
            r = (t.pop() || "") + "[]", n = "property";
          else {
            const u = Number.parseInt(r, 10);
            !Number.isNaN(u) && Number.isFinite(u) && u >= 0 && u <= Number.MAX_SAFE_INTEGER && u <= Ho && r === String(u) ? t.push(u) : t.push(r), r = "", n = "indexEnd";
          }
          break;
        }
        if (n === "indexEnd")
          throw new Error(`Invalid character '${o}' after an index at position ${a}`);
        r += o;
        break;
      }
      default: {
        if (n === "index" && !xc(o))
          throw new Error(`Invalid character '${o}' in an index at position ${a}`);
        if (n === "indexEnd")
          throw new Error(`Invalid character '${o}' after an index at position ${a}`);
        n === "start" && (n = "property"), r += o;
      }
    }
  }
  switch (s && (r += "\\"), n) {
    case "property": {
      if (!Pn(r, t))
        return [];
      break;
    }
    case "index":
      throw new Error("Index was not closed");
    case "start": {
      t.push("");
      break;
    }
  }
  return t;
}
function Wr(e) {
  if (typeof e == "string")
    return Bc(e);
  if (Array.isArray(e)) {
    const t = [];
    for (const [r, n] of e.entries()) {
      if (typeof n != "string" && typeof n != "number")
        throw new TypeError(`Expected a string or number for path segment at index ${r}, got ${typeof n}`);
      if (typeof n == "number" && !Number.isFinite(n))
        throw new TypeError(`Path segment at index ${r} must be a finite number, got ${n}`);
      if (Ko.has(n))
        return [];
      typeof n == "string" && Wo(n) ? t.push(Number.parseInt(n, 10)) : t.push(n);
    }
    return t;
  }
  return [];
}
function Na(e, t, r) {
  if (!$t(e) || typeof t != "string" && !Array.isArray(t))
    return r === void 0 ? e : r;
  const n = Wr(t);
  if (n.length === 0)
    return r;
  for (let s = 0; s < n.length; s++) {
    const a = n[s];
    if (e = e[a], e == null) {
      if (s !== n.length - 1)
        return r;
      break;
    }
  }
  return e === void 0 ? r : e;
}
function lr(e, t, r) {
  if (!$t(e) || typeof t != "string" && !Array.isArray(t))
    return e;
  const n = e, s = Wr(t);
  if (s.length === 0)
    return e;
  for (let a = 0; a < s.length; a++) {
    const o = s[a];
    if (a === s.length - 1)
      e[o] = r;
    else if (!$t(e[o])) {
      const i = typeof s[a + 1] == "number";
      e[o] = i ? [] : {};
    }
    e = e[o];
  }
  return n;
}
function Xc(e, t) {
  if (!$t(e) || typeof t != "string" && !Array.isArray(t))
    return !1;
  const r = Wr(t);
  if (r.length === 0)
    return !1;
  for (let n = 0; n < r.length; n++) {
    const s = r[n];
    if (n === r.length - 1)
      return Object.hasOwn(e, s) ? (delete e[s], !0) : !1;
    if (e = e[s], !$t(e))
      return !1;
  }
}
function Rn(e, t) {
  if (!$t(e) || typeof t != "string" && !Array.isArray(t))
    return !1;
  const r = Wr(t);
  if (r.length === 0)
    return !1;
  for (const n of r) {
    if (!$t(e) || !(n in e))
      return !1;
    e = e[n];
  }
  return !0;
}
const nt = Vo.homedir(), cs = Vo.tmpdir(), { env: It } = se, Yc = (e) => {
  const t = H.join(nt, "Library");
  return {
    data: H.join(t, "Application Support", e),
    config: H.join(t, "Preferences", e),
    cache: H.join(t, "Caches", e),
    log: H.join(t, "Logs", e),
    temp: H.join(cs, e)
  };
}, Jc = (e) => {
  const t = It.APPDATA || H.join(nt, "AppData", "Roaming"), r = It.LOCALAPPDATA || H.join(nt, "AppData", "Local");
  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    data: H.join(r, e, "Data"),
    config: H.join(t, e, "Config"),
    cache: H.join(r, e, "Cache"),
    log: H.join(r, e, "Log"),
    temp: H.join(cs, e)
  };
}, Zc = (e) => {
  const t = H.basename(nt);
  return {
    data: H.join(It.XDG_DATA_HOME || H.join(nt, ".local", "share"), e),
    config: H.join(It.XDG_CONFIG_HOME || H.join(nt, ".config"), e),
    cache: H.join(It.XDG_CACHE_HOME || H.join(nt, ".cache"), e),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: H.join(It.XDG_STATE_HOME || H.join(nt, ".local", "state"), e),
    temp: H.join(cs, t, e)
  };
};
function Qc(e, { suffix: t = "nodejs" } = {}) {
  if (typeof e != "string")
    throw new TypeError(`Expected a string, got ${typeof e}`);
  return t && (e += `-${t}`), se.platform === "darwin" ? Yc(e) : se.platform === "win32" ? Jc(e) : Zc(e);
}
const Xe = (e, t) => {
  const { onError: r } = t;
  return function(...s) {
    return e.apply(void 0, s).catch(r);
  };
}, qe = (e, t) => {
  const { onError: r } = t;
  return function(...s) {
    try {
      return e.apply(void 0, s);
    } catch (a) {
      return r(a);
    }
  };
}, eu = 250, Ye = (e, t) => {
  const { isRetriable: r } = t;
  return function(s) {
    const { timeout: a } = s, o = s.interval ?? eu, u = Date.now() + a;
    return function i(...f) {
      return e.apply(void 0, f).catch((c) => {
        if (!r(c) || Date.now() >= u)
          throw c;
        const p = Math.round(o * Math.random());
        return p > 0 ? new Promise((y) => setTimeout(y, p)).then(() => i.apply(void 0, f)) : i.apply(void 0, f);
      });
    };
  };
}, Je = (e, t) => {
  const { isRetriable: r } = t;
  return function(s) {
    const { timeout: a } = s, o = Date.now() + a;
    return function(...i) {
      for (; ; )
        try {
          return e.apply(void 0, i);
        } catch (f) {
          if (!r(f) || Date.now() >= o)
            throw f;
          continue;
        }
    };
  };
}, Nt = {
  /* API */
  isChangeErrorOk: (e) => {
    if (!Nt.isNodeError(e))
      return !1;
    const { code: t } = e;
    return t === "ENOSYS" || !tu && (t === "EINVAL" || t === "EPERM");
  },
  isNodeError: (e) => e instanceof Error,
  isRetriableError: (e) => {
    if (!Nt.isNodeError(e))
      return !1;
    const { code: t } = e;
    return t === "EMFILE" || t === "ENFILE" || t === "EAGAIN" || t === "EBUSY" || t === "EACCESS" || t === "EACCES" || t === "EACCS" || t === "EPERM";
  },
  onChangeError: (e) => {
    if (!Nt.isNodeError(e))
      throw e;
    if (!Nt.isChangeErrorOk(e))
      throw e;
  }
}, fr = {
  onError: Nt.onChangeError
}, Oe = {
  onError: () => {
  }
}, tu = se.getuid ? !se.getuid() : !1, ye = {
  isRetriable: Nt.isRetriableError
}, ge = {
  attempt: {
    /* ASYNC */
    chmod: Xe(pe(B.chmod), fr),
    chown: Xe(pe(B.chown), fr),
    close: Xe(pe(B.close), Oe),
    fsync: Xe(pe(B.fsync), Oe),
    mkdir: Xe(pe(B.mkdir), Oe),
    realpath: Xe(pe(B.realpath), Oe),
    stat: Xe(pe(B.stat), Oe),
    unlink: Xe(pe(B.unlink), Oe),
    /* SYNC */
    chmodSync: qe(B.chmodSync, fr),
    chownSync: qe(B.chownSync, fr),
    closeSync: qe(B.closeSync, Oe),
    existsSync: qe(B.existsSync, Oe),
    fsyncSync: qe(B.fsync, Oe),
    mkdirSync: qe(B.mkdirSync, Oe),
    realpathSync: qe(B.realpathSync, Oe),
    statSync: qe(B.statSync, Oe),
    unlinkSync: qe(B.unlinkSync, Oe)
  },
  retry: {
    /* ASYNC */
    close: Ye(pe(B.close), ye),
    fsync: Ye(pe(B.fsync), ye),
    open: Ye(pe(B.open), ye),
    readFile: Ye(pe(B.readFile), ye),
    rename: Ye(pe(B.rename), ye),
    stat: Ye(pe(B.stat), ye),
    write: Ye(pe(B.write), ye),
    writeFile: Ye(pe(B.writeFile), ye),
    /* SYNC */
    closeSync: Je(B.closeSync, ye),
    fsyncSync: Je(B.fsyncSync, ye),
    openSync: Je(B.openSync, ye),
    readFileSync: Je(B.readFileSync, ye),
    renameSync: Je(B.renameSync, ye),
    statSync: Je(B.statSync, ye),
    writeSync: Je(B.writeSync, ye),
    writeFileSync: Je(B.writeFileSync, ye)
  }
}, ru = "utf8", Ta = 438, nu = 511, su = {}, au = se.geteuid ? se.geteuid() : -1, ou = se.getegid ? se.getegid() : -1, iu = 1e3, cu = !!se.getuid;
se.getuid && se.getuid();
const ja = 128, uu = (e) => e instanceof Error && "code" in e, Aa = (e) => typeof e == "string", On = (e) => e === void 0, lu = se.platform === "linux", xo = se.platform === "win32", us = ["SIGHUP", "SIGINT", "SIGTERM"];
xo || us.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
lu && us.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
class fu {
  /* CONSTRUCTOR */
  constructor() {
    this.callbacks = /* @__PURE__ */ new Set(), this.exited = !1, this.exit = (t) => {
      if (!this.exited) {
        this.exited = !0;
        for (const r of this.callbacks)
          r();
        t && (xo && t !== "SIGINT" && t !== "SIGTERM" && t !== "SIGKILL" ? se.kill(se.pid, "SIGTERM") : se.kill(se.pid, t));
      }
    }, this.hook = () => {
      se.once("exit", () => this.exit());
      for (const t of us)
        try {
          se.once(t, () => this.exit(t));
        } catch {
        }
    }, this.register = (t) => (this.callbacks.add(t), () => {
      this.callbacks.delete(t);
    }), this.hook();
  }
}
const du = new fu(), hu = du.register, ve = {
  /* VARIABLES */
  store: {},
  // filePath => purge
  /* API */
  create: (e) => {
    const t = `000000${Math.floor(Math.random() * 16777215).toString(16)}`.slice(-6), s = `.tmp-${Date.now().toString().slice(-10)}${t}`;
    return `${e}${s}`;
  },
  get: (e, t, r = !0) => {
    const n = ve.truncate(t(e));
    return n in ve.store ? ve.get(e, t, r) : (ve.store[n] = r, [n, () => delete ve.store[n]]);
  },
  purge: (e) => {
    ve.store[e] && (delete ve.store[e], ge.attempt.unlink(e));
  },
  purgeSync: (e) => {
    ve.store[e] && (delete ve.store[e], ge.attempt.unlinkSync(e));
  },
  purgeSyncAll: () => {
    for (const e in ve.store)
      ve.purgeSync(e);
  },
  truncate: (e) => {
    const t = H.basename(e);
    if (t.length <= ja)
      return e;
    const r = /^(\.?)(.*?)((?:\.[^.]+)?(?:\.tmp-\d{10}[a-f0-9]{6})?)$/.exec(t);
    if (!r)
      return e;
    const n = t.length - ja;
    return `${e.slice(0, -t.length)}${r[1]}${r[2].slice(0, -n)}${r[3]}`;
  }
};
hu(ve.purgeSyncAll);
function Bo(e, t, r = su) {
  if (Aa(r))
    return Bo(e, t, { encoding: r });
  const s = { timeout: r.timeout ?? iu };
  let a = null, o = null, u = null;
  try {
    const i = ge.attempt.realpathSync(e), f = !!i;
    e = i || e, [o, a] = ve.get(e, r.tmpCreate || ve.create, r.tmpPurge !== !1);
    const c = cu && On(r.chown), p = On(r.mode);
    if (f && (c || p)) {
      const w = ge.attempt.statSync(e);
      w && (r = { ...r }, c && (r.chown = { uid: w.uid, gid: w.gid }), p && (r.mode = w.mode));
    }
    if (!f) {
      const w = H.dirname(e);
      ge.attempt.mkdirSync(w, {
        mode: nu,
        recursive: !0
      });
    }
    u = ge.retry.openSync(s)(o, "w", r.mode || Ta), r.tmpCreated && r.tmpCreated(o), Aa(t) ? ge.retry.writeSync(s)(u, t, 0, r.encoding || ru) : On(t) || ge.retry.writeSync(s)(u, t, 0, t.length, 0), r.fsync !== !1 && (r.fsyncWait !== !1 ? ge.retry.fsyncSync(s)(u) : ge.attempt.fsync(u)), ge.retry.closeSync(s)(u), u = null, r.chown && (r.chown.uid !== au || r.chown.gid !== ou) && ge.attempt.chownSync(o, r.chown.uid, r.chown.gid), r.mode && r.mode !== Ta && ge.attempt.chmodSync(o, r.mode);
    try {
      ge.retry.renameSync(s)(o, e);
    } catch (w) {
      if (!uu(w) || w.code !== "ENAMETOOLONG")
        throw w;
      ge.retry.renameSync(s)(o, ve.truncate(e));
    }
    a(), o = null;
  } finally {
    u && ge.attempt.closeSync(u), o && ve.purge(o);
  }
}
var Hn = { exports: {} }, ls = {}, Ae = {}, Lt = {}, nr = {}, q = {}, rr = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.regexpCode = e.getEsmExportName = e.getProperty = e.safeStringify = e.stringify = e.strConcat = e.addCodeArg = e.str = e._ = e.nil = e._Code = e.Name = e.IDENTIFIER = e._CodeOrName = void 0;
  class t {
  }
  e._CodeOrName = t, e.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
  class r extends t {
    constructor($) {
      if (super(), !e.IDENTIFIER.test($))
        throw new Error("CodeGen: name must be a valid identifier");
      this.str = $;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      return !1;
    }
    get names() {
      return { [this.str]: 1 };
    }
  }
  e.Name = r;
  class n extends t {
    constructor($) {
      super(), this._items = typeof $ == "string" ? [$] : $;
    }
    toString() {
      return this.str;
    }
    emptyStr() {
      if (this._items.length > 1)
        return !1;
      const $ = this._items[0];
      return $ === "" || $ === '""';
    }
    get str() {
      var $;
      return ($ = this._str) !== null && $ !== void 0 ? $ : this._str = this._items.reduce((P, R) => `${P}${R}`, "");
    }
    get names() {
      var $;
      return ($ = this._names) !== null && $ !== void 0 ? $ : this._names = this._items.reduce((P, R) => (R instanceof r && (P[R.str] = (P[R.str] || 0) + 1), P), {});
    }
  }
  e._Code = n, e.nil = new n("");
  function s(m, ...$) {
    const P = [m[0]];
    let R = 0;
    for (; R < $.length; )
      u(P, $[R]), P.push(m[++R]);
    return new n(P);
  }
  e._ = s;
  const a = new n("+");
  function o(m, ...$) {
    const P = [y(m[0])];
    let R = 0;
    for (; R < $.length; )
      P.push(a), u(P, $[R]), P.push(a, y(m[++R]));
    return i(P), new n(P);
  }
  e.str = o;
  function u(m, $) {
    $ instanceof n ? m.push(...$._items) : $ instanceof r ? m.push($) : m.push(p($));
  }
  e.addCodeArg = u;
  function i(m) {
    let $ = 1;
    for (; $ < m.length - 1; ) {
      if (m[$] === a) {
        const P = f(m[$ - 1], m[$ + 1]);
        if (P !== void 0) {
          m.splice($ - 1, 3, P);
          continue;
        }
        m[$++] = "+";
      }
      $++;
    }
  }
  function f(m, $) {
    if ($ === '""')
      return m;
    if (m === '""')
      return $;
    if (typeof m == "string")
      return $ instanceof r || m[m.length - 1] !== '"' ? void 0 : typeof $ != "string" ? `${m.slice(0, -1)}${$}"` : $[0] === '"' ? m.slice(0, -1) + $.slice(1) : void 0;
    if (typeof $ == "string" && $[0] === '"' && !(m instanceof r))
      return `"${m}${$.slice(1)}`;
  }
  function c(m, $) {
    return $.emptyStr() ? m : m.emptyStr() ? $ : o`${m}${$}`;
  }
  e.strConcat = c;
  function p(m) {
    return typeof m == "number" || typeof m == "boolean" || m === null ? m : y(Array.isArray(m) ? m.join(",") : m);
  }
  function w(m) {
    return new n(y(m));
  }
  e.stringify = w;
  function y(m) {
    return JSON.stringify(m).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  e.safeStringify = y;
  function b(m) {
    return typeof m == "string" && e.IDENTIFIER.test(m) ? new n(`.${m}`) : s`[${m}]`;
  }
  e.getProperty = b;
  function _(m) {
    if (typeof m == "string" && e.IDENTIFIER.test(m))
      return new n(`${m}`);
    throw new Error(`CodeGen: invalid export name: ${m}, use explicit $id name mapping`);
  }
  e.getEsmExportName = _;
  function d(m) {
    return new n(m.toString());
  }
  e.regexpCode = d;
})(rr);
var Wn = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.ValueScope = e.ValueScopeName = e.Scope = e.varKinds = e.UsedValueState = void 0;
  const t = rr;
  class r extends Error {
    constructor(f) {
      super(`CodeGen: "code" for ${f} not defined`), this.value = f.value;
    }
  }
  var n;
  (function(i) {
    i[i.Started = 0] = "Started", i[i.Completed = 1] = "Completed";
  })(n || (e.UsedValueState = n = {})), e.varKinds = {
    const: new t.Name("const"),
    let: new t.Name("let"),
    var: new t.Name("var")
  };
  class s {
    constructor({ prefixes: f, parent: c } = {}) {
      this._names = {}, this._prefixes = f, this._parent = c;
    }
    toName(f) {
      return f instanceof t.Name ? f : this.name(f);
    }
    name(f) {
      return new t.Name(this._newName(f));
    }
    _newName(f) {
      const c = this._names[f] || this._nameGroup(f);
      return `${f}${c.index++}`;
    }
    _nameGroup(f) {
      var c, p;
      if (!((p = (c = this._parent) === null || c === void 0 ? void 0 : c._prefixes) === null || p === void 0) && p.has(f) || this._prefixes && !this._prefixes.has(f))
        throw new Error(`CodeGen: prefix "${f}" is not allowed in this scope`);
      return this._names[f] = { prefix: f, index: 0 };
    }
  }
  e.Scope = s;
  class a extends t.Name {
    constructor(f, c) {
      super(c), this.prefix = f;
    }
    setValue(f, { property: c, itemIndex: p }) {
      this.value = f, this.scopePath = (0, t._)`.${new t.Name(c)}[${p}]`;
    }
  }
  e.ValueScopeName = a;
  const o = (0, t._)`\n`;
  class u extends s {
    constructor(f) {
      super(f), this._values = {}, this._scope = f.scope, this.opts = { ...f, _n: f.lines ? o : t.nil };
    }
    get() {
      return this._scope;
    }
    name(f) {
      return new a(f, this._newName(f));
    }
    value(f, c) {
      var p;
      if (c.ref === void 0)
        throw new Error("CodeGen: ref must be passed in value");
      const w = this.toName(f), { prefix: y } = w, b = (p = c.key) !== null && p !== void 0 ? p : c.ref;
      let _ = this._values[y];
      if (_) {
        const $ = _.get(b);
        if ($)
          return $;
      } else
        _ = this._values[y] = /* @__PURE__ */ new Map();
      _.set(b, w);
      const d = this._scope[y] || (this._scope[y] = []), m = d.length;
      return d[m] = c.ref, w.setValue(c, { property: y, itemIndex: m }), w;
    }
    getValue(f, c) {
      const p = this._values[f];
      if (p)
        return p.get(c);
    }
    scopeRefs(f, c = this._values) {
      return this._reduceValues(c, (p) => {
        if (p.scopePath === void 0)
          throw new Error(`CodeGen: name "${p}" has no value`);
        return (0, t._)`${f}${p.scopePath}`;
      });
    }
    scopeCode(f = this._values, c, p) {
      return this._reduceValues(f, (w) => {
        if (w.value === void 0)
          throw new Error(`CodeGen: name "${w}" has no value`);
        return w.value.code;
      }, c, p);
    }
    _reduceValues(f, c, p = {}, w) {
      let y = t.nil;
      for (const b in f) {
        const _ = f[b];
        if (!_)
          continue;
        const d = p[b] = p[b] || /* @__PURE__ */ new Map();
        _.forEach((m) => {
          if (d.has(m))
            return;
          d.set(m, n.Started);
          let $ = c(m);
          if ($) {
            const P = this.opts.es5 ? e.varKinds.var : e.varKinds.const;
            y = (0, t._)`${y}${P} ${m} = ${$};${this.opts._n}`;
          } else if ($ = w == null ? void 0 : w(m))
            y = (0, t._)`${y}${$}${this.opts._n}`;
          else
            throw new r(m);
          d.set(m, n.Completed);
        });
      }
      return y;
    }
  }
  e.ValueScope = u;
})(Wn);
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.or = e.and = e.not = e.CodeGen = e.operators = e.varKinds = e.ValueScopeName = e.ValueScope = e.Scope = e.Name = e.regexpCode = e.stringify = e.getProperty = e.nil = e.strConcat = e.str = e._ = void 0;
  const t = rr, r = Wn;
  var n = rr;
  Object.defineProperty(e, "_", { enumerable: !0, get: function() {
    return n._;
  } }), Object.defineProperty(e, "str", { enumerable: !0, get: function() {
    return n.str;
  } }), Object.defineProperty(e, "strConcat", { enumerable: !0, get: function() {
    return n.strConcat;
  } }), Object.defineProperty(e, "nil", { enumerable: !0, get: function() {
    return n.nil;
  } }), Object.defineProperty(e, "getProperty", { enumerable: !0, get: function() {
    return n.getProperty;
  } }), Object.defineProperty(e, "stringify", { enumerable: !0, get: function() {
    return n.stringify;
  } }), Object.defineProperty(e, "regexpCode", { enumerable: !0, get: function() {
    return n.regexpCode;
  } }), Object.defineProperty(e, "Name", { enumerable: !0, get: function() {
    return n.Name;
  } });
  var s = Wn;
  Object.defineProperty(e, "Scope", { enumerable: !0, get: function() {
    return s.Scope;
  } }), Object.defineProperty(e, "ValueScope", { enumerable: !0, get: function() {
    return s.ValueScope;
  } }), Object.defineProperty(e, "ValueScopeName", { enumerable: !0, get: function() {
    return s.ValueScopeName;
  } }), Object.defineProperty(e, "varKinds", { enumerable: !0, get: function() {
    return s.varKinds;
  } }), e.operators = {
    GT: new t._Code(">"),
    GTE: new t._Code(">="),
    LT: new t._Code("<"),
    LTE: new t._Code("<="),
    EQ: new t._Code("==="),
    NEQ: new t._Code("!=="),
    NOT: new t._Code("!"),
    OR: new t._Code("||"),
    AND: new t._Code("&&"),
    ADD: new t._Code("+")
  };
  class a {
    optimizeNodes() {
      return this;
    }
    optimizeNames(l, h) {
      return this;
    }
  }
  class o extends a {
    constructor(l, h, E) {
      super(), this.varKind = l, this.name = h, this.rhs = E;
    }
    render({ es5: l, _n: h }) {
      const E = l ? r.varKinds.var : this.varKind, N = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
      return `${E} ${this.name}${N};` + h;
    }
    optimizeNames(l, h) {
      if (l[this.name.str])
        return this.rhs && (this.rhs = K(this.rhs, l, h)), this;
    }
    get names() {
      return this.rhs instanceof t._CodeOrName ? this.rhs.names : {};
    }
  }
  class u extends a {
    constructor(l, h, E) {
      super(), this.lhs = l, this.rhs = h, this.sideEffects = E;
    }
    render({ _n: l }) {
      return `${this.lhs} = ${this.rhs};` + l;
    }
    optimizeNames(l, h) {
      if (!(this.lhs instanceof t.Name && !l[this.lhs.str] && !this.sideEffects))
        return this.rhs = K(this.rhs, l, h), this;
    }
    get names() {
      const l = this.lhs instanceof t.Name ? {} : { ...this.lhs.names };
      return Z(l, this.rhs);
    }
  }
  class i extends u {
    constructor(l, h, E, N) {
      super(l, E, N), this.op = h;
    }
    render({ _n: l }) {
      return `${this.lhs} ${this.op}= ${this.rhs};` + l;
    }
  }
  class f extends a {
    constructor(l) {
      super(), this.label = l, this.names = {};
    }
    render({ _n: l }) {
      return `${this.label}:` + l;
    }
  }
  class c extends a {
    constructor(l) {
      super(), this.label = l, this.names = {};
    }
    render({ _n: l }) {
      return `break${this.label ? ` ${this.label}` : ""};` + l;
    }
  }
  class p extends a {
    constructor(l) {
      super(), this.error = l;
    }
    render({ _n: l }) {
      return `throw ${this.error};` + l;
    }
    get names() {
      return this.error.names;
    }
  }
  class w extends a {
    constructor(l) {
      super(), this.code = l;
    }
    render({ _n: l }) {
      return `${this.code};` + l;
    }
    optimizeNodes() {
      return `${this.code}` ? this : void 0;
    }
    optimizeNames(l, h) {
      return this.code = K(this.code, l, h), this;
    }
    get names() {
      return this.code instanceof t._CodeOrName ? this.code.names : {};
    }
  }
  class y extends a {
    constructor(l = []) {
      super(), this.nodes = l;
    }
    render(l) {
      return this.nodes.reduce((h, E) => h + E.render(l), "");
    }
    optimizeNodes() {
      const { nodes: l } = this;
      let h = l.length;
      for (; h--; ) {
        const E = l[h].optimizeNodes();
        Array.isArray(E) ? l.splice(h, 1, ...E) : E ? l[h] = E : l.splice(h, 1);
      }
      return l.length > 0 ? this : void 0;
    }
    optimizeNames(l, h) {
      const { nodes: E } = this;
      let N = E.length;
      for (; N--; ) {
        const j = E[N];
        j.optimizeNames(l, h) || (oe(l, j.names), E.splice(N, 1));
      }
      return E.length > 0 ? this : void 0;
    }
    get names() {
      return this.nodes.reduce((l, h) => G(l, h.names), {});
    }
  }
  class b extends y {
    render(l) {
      return "{" + l._n + super.render(l) + "}" + l._n;
    }
  }
  class _ extends y {
  }
  class d extends b {
  }
  d.kind = "else";
  class m extends b {
    constructor(l, h) {
      super(h), this.condition = l;
    }
    render(l) {
      let h = `if(${this.condition})` + super.render(l);
      return this.else && (h += "else " + this.else.render(l)), h;
    }
    optimizeNodes() {
      super.optimizeNodes();
      const l = this.condition;
      if (l === !0)
        return this.nodes;
      let h = this.else;
      if (h) {
        const E = h.optimizeNodes();
        h = this.else = Array.isArray(E) ? new d(E) : E;
      }
      if (h)
        return l === !1 ? h instanceof m ? h : h.nodes : this.nodes.length ? this : new m(Se(l), h instanceof m ? [h] : h.nodes);
      if (!(l === !1 || !this.nodes.length))
        return this;
    }
    optimizeNames(l, h) {
      var E;
      if (this.else = (E = this.else) === null || E === void 0 ? void 0 : E.optimizeNames(l, h), !!(super.optimizeNames(l, h) || this.else))
        return this.condition = K(this.condition, l, h), this;
    }
    get names() {
      const l = super.names;
      return Z(l, this.condition), this.else && G(l, this.else.names), l;
    }
  }
  m.kind = "if";
  class $ extends b {
  }
  $.kind = "for";
  class P extends $ {
    constructor(l) {
      super(), this.iteration = l;
    }
    render(l) {
      return `for(${this.iteration})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iteration = K(this.iteration, l, h), this;
    }
    get names() {
      return G(super.names, this.iteration.names);
    }
  }
  class R extends $ {
    constructor(l, h, E, N) {
      super(), this.varKind = l, this.name = h, this.from = E, this.to = N;
    }
    render(l) {
      const h = l.es5 ? r.varKinds.var : this.varKind, { name: E, from: N, to: j } = this;
      return `for(${h} ${E}=${N}; ${E}<${j}; ${E}++)` + super.render(l);
    }
    get names() {
      const l = Z(super.names, this.from);
      return Z(l, this.to);
    }
  }
  class I extends $ {
    constructor(l, h, E, N) {
      super(), this.loop = l, this.varKind = h, this.name = E, this.iterable = N;
    }
    render(l) {
      return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(l);
    }
    optimizeNames(l, h) {
      if (super.optimizeNames(l, h))
        return this.iterable = K(this.iterable, l, h), this;
    }
    get names() {
      return G(super.names, this.iterable.names);
    }
  }
  class T extends b {
    constructor(l, h, E) {
      super(), this.name = l, this.args = h, this.async = E;
    }
    render(l) {
      return `${this.async ? "async " : ""}function ${this.name}(${this.args})` + super.render(l);
    }
  }
  T.kind = "func";
  class V extends y {
    render(l) {
      return "return " + super.render(l);
    }
  }
  V.kind = "return";
  class J extends b {
    render(l) {
      let h = "try" + super.render(l);
      return this.catch && (h += this.catch.render(l)), this.finally && (h += this.finally.render(l)), h;
    }
    optimizeNodes() {
      var l, h;
      return super.optimizeNodes(), (l = this.catch) === null || l === void 0 || l.optimizeNodes(), (h = this.finally) === null || h === void 0 || h.optimizeNodes(), this;
    }
    optimizeNames(l, h) {
      var E, N;
      return super.optimizeNames(l, h), (E = this.catch) === null || E === void 0 || E.optimizeNames(l, h), (N = this.finally) === null || N === void 0 || N.optimizeNames(l, h), this;
    }
    get names() {
      const l = super.names;
      return this.catch && G(l, this.catch.names), this.finally && G(l, this.finally.names), l;
    }
  }
  class ae extends b {
    constructor(l) {
      super(), this.error = l;
    }
    render(l) {
      return `catch(${this.error})` + super.render(l);
    }
  }
  ae.kind = "catch";
  class de extends b {
    render(l) {
      return "finally" + super.render(l);
    }
  }
  de.kind = "finally";
  class M {
    constructor(l, h = {}) {
      this._values = {}, this._blockStarts = [], this._constants = {}, this.opts = { ...h, _n: h.lines ? `
` : "" }, this._extScope = l, this._scope = new r.Scope({ parent: l }), this._nodes = [new _()];
    }
    toString() {
      return this._root.render(this.opts);
    }
    // returns unique name in the internal scope
    name(l) {
      return this._scope.name(l);
    }
    // reserves unique name in the external scope
    scopeName(l) {
      return this._extScope.name(l);
    }
    // reserves unique name in the external scope and assigns value to it
    scopeValue(l, h) {
      const E = this._extScope.value(l, h);
      return (this._values[E.prefix] || (this._values[E.prefix] = /* @__PURE__ */ new Set())).add(E), E;
    }
    getScopeValue(l, h) {
      return this._extScope.getValue(l, h);
    }
    // return code that assigns values in the external scope to the names that are used internally
    // (same names that were returned by gen.scopeName or gen.scopeValue)
    scopeRefs(l) {
      return this._extScope.scopeRefs(l, this._values);
    }
    scopeCode() {
      return this._extScope.scopeCode(this._values);
    }
    _def(l, h, E, N) {
      const j = this._scope.toName(h);
      return E !== void 0 && N && (this._constants[j.str] = E), this._leafNode(new o(l, j, E)), j;
    }
    // `const` declaration (`var` in es5 mode)
    const(l, h, E) {
      return this._def(r.varKinds.const, l, h, E);
    }
    // `let` declaration with optional assignment (`var` in es5 mode)
    let(l, h, E) {
      return this._def(r.varKinds.let, l, h, E);
    }
    // `var` declaration with optional assignment
    var(l, h, E) {
      return this._def(r.varKinds.var, l, h, E);
    }
    // assignment code
    assign(l, h, E) {
      return this._leafNode(new u(l, h, E));
    }
    // `+=` code
    add(l, h) {
      return this._leafNode(new i(l, e.operators.ADD, h));
    }
    // appends passed SafeExpr to code or executes Block
    code(l) {
      return typeof l == "function" ? l() : l !== t.nil && this._leafNode(new w(l)), this;
    }
    // returns code for object literal for the passed argument list of key-value pairs
    object(...l) {
      const h = ["{"];
      for (const [E, N] of l)
        h.length > 1 && h.push(","), h.push(E), (E !== N || this.opts.es5) && (h.push(":"), (0, t.addCodeArg)(h, N));
      return h.push("}"), new t._Code(h);
    }
    // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
    if(l, h, E) {
      if (this._blockNode(new m(l)), h && E)
        this.code(h).else().code(E).endIf();
      else if (h)
        this.code(h).endIf();
      else if (E)
        throw new Error('CodeGen: "else" body without "then" body');
      return this;
    }
    // `else if` clause - invalid without `if` or after `else` clauses
    elseIf(l) {
      return this._elseNode(new m(l));
    }
    // `else` clause - only valid after `if` or `else if` clauses
    else() {
      return this._elseNode(new d());
    }
    // end `if` statement (needed if gen.if was used only with condition)
    endIf() {
      return this._endBlockNode(m, d);
    }
    _for(l, h) {
      return this._blockNode(l), h && this.code(h).endFor(), this;
    }
    // a generic `for` clause (or statement if `forBody` is passed)
    for(l, h) {
      return this._for(new P(l), h);
    }
    // `for` statement for a range of values
    forRange(l, h, E, N, j = this.opts.es5 ? r.varKinds.var : r.varKinds.let) {
      const F = this._scope.toName(l);
      return this._for(new R(j, F, h, E), () => N(F));
    }
    // `for-of` statement (in es5 mode replace with a normal for loop)
    forOf(l, h, E, N = r.varKinds.const) {
      const j = this._scope.toName(l);
      if (this.opts.es5) {
        const F = h instanceof t.Name ? h : this.var("_arr", h);
        return this.forRange("_i", 0, (0, t._)`${F}.length`, (z) => {
          this.var(j, (0, t._)`${F}[${z}]`), E(j);
        });
      }
      return this._for(new I("of", N, j, h), () => E(j));
    }
    // `for-in` statement.
    // With option `ownProperties` replaced with a `for-of` loop for object keys
    forIn(l, h, E, N = this.opts.es5 ? r.varKinds.var : r.varKinds.const) {
      if (this.opts.ownProperties)
        return this.forOf(l, (0, t._)`Object.keys(${h})`, E);
      const j = this._scope.toName(l);
      return this._for(new I("in", N, j, h), () => E(j));
    }
    // end `for` loop
    endFor() {
      return this._endBlockNode($);
    }
    // `label` statement
    label(l) {
      return this._leafNode(new f(l));
    }
    // `break` statement
    break(l) {
      return this._leafNode(new c(l));
    }
    // `return` statement
    return(l) {
      const h = new V();
      if (this._blockNode(h), this.code(l), h.nodes.length !== 1)
        throw new Error('CodeGen: "return" should have one node');
      return this._endBlockNode(V);
    }
    // `try` statement
    try(l, h, E) {
      if (!h && !E)
        throw new Error('CodeGen: "try" without "catch" and "finally"');
      const N = new J();
      if (this._blockNode(N), this.code(l), h) {
        const j = this.name("e");
        this._currNode = N.catch = new ae(j), h(j);
      }
      return E && (this._currNode = N.finally = new de(), this.code(E)), this._endBlockNode(ae, de);
    }
    // `throw` statement
    throw(l) {
      return this._leafNode(new p(l));
    }
    // start self-balancing block
    block(l, h) {
      return this._blockStarts.push(this._nodes.length), l && this.code(l).endBlock(h), this;
    }
    // end the current self-balancing block
    endBlock(l) {
      const h = this._blockStarts.pop();
      if (h === void 0)
        throw new Error("CodeGen: not in self-balancing block");
      const E = this._nodes.length - h;
      if (E < 0 || l !== void 0 && E !== l)
        throw new Error(`CodeGen: wrong number of nodes: ${E} vs ${l} expected`);
      return this._nodes.length = h, this;
    }
    // `function` heading (or definition if funcBody is passed)
    func(l, h = t.nil, E, N) {
      return this._blockNode(new T(l, h, E)), N && this.code(N).endFunc(), this;
    }
    // end function definition
    endFunc() {
      return this._endBlockNode(T);
    }
    optimize(l = 1) {
      for (; l-- > 0; )
        this._root.optimizeNodes(), this._root.optimizeNames(this._root.names, this._constants);
    }
    _leafNode(l) {
      return this._currNode.nodes.push(l), this;
    }
    _blockNode(l) {
      this._currNode.nodes.push(l), this._nodes.push(l);
    }
    _endBlockNode(l, h) {
      const E = this._currNode;
      if (E instanceof l || h && E instanceof h)
        return this._nodes.pop(), this;
      throw new Error(`CodeGen: not in block "${h ? `${l.kind}/${h.kind}` : l.kind}"`);
    }
    _elseNode(l) {
      const h = this._currNode;
      if (!(h instanceof m))
        throw new Error('CodeGen: "else" without "if"');
      return this._currNode = h.else = l, this;
    }
    get _root() {
      return this._nodes[0];
    }
    get _currNode() {
      const l = this._nodes;
      return l[l.length - 1];
    }
    set _currNode(l) {
      const h = this._nodes;
      h[h.length - 1] = l;
    }
  }
  e.CodeGen = M;
  function G(v, l) {
    for (const h in l)
      v[h] = (v[h] || 0) + (l[h] || 0);
    return v;
  }
  function Z(v, l) {
    return l instanceof t._CodeOrName ? G(v, l.names) : v;
  }
  function K(v, l, h) {
    if (v instanceof t.Name)
      return E(v);
    if (!N(v))
      return v;
    return new t._Code(v._items.reduce((j, F) => (F instanceof t.Name && (F = E(F)), F instanceof t._Code ? j.push(...F._items) : j.push(F), j), []));
    function E(j) {
      const F = h[j.str];
      return F === void 0 || l[j.str] !== 1 ? j : (delete l[j.str], F);
    }
    function N(j) {
      return j instanceof t._Code && j._items.some((F) => F instanceof t.Name && l[F.str] === 1 && h[F.str] !== void 0);
    }
  }
  function oe(v, l) {
    for (const h in l)
      v[h] = (v[h] || 0) - (l[h] || 0);
  }
  function Se(v) {
    return typeof v == "boolean" || typeof v == "number" || v === null ? !v : (0, t._)`!${S(v)}`;
  }
  e.not = Se;
  const k = g(e.operators.AND);
  function A(...v) {
    return v.reduce(k);
  }
  e.and = A;
  const D = g(e.operators.OR);
  function O(...v) {
    return v.reduce(D);
  }
  e.or = O;
  function g(v) {
    return (l, h) => l === t.nil ? h : h === t.nil ? l : (0, t._)`${S(l)} ${v} ${S(h)}`;
  }
  function S(v) {
    return v instanceof t.Name ? v : (0, t._)`(${v})`;
  }
})(q);
var C = {};
Object.defineProperty(C, "__esModule", { value: !0 });
C.checkStrictMode = C.getErrorPath = C.Type = C.useFunc = C.setEvaluated = C.evaluatedPropsToName = C.mergeEvaluated = C.eachItem = C.unescapeJsonPointer = C.escapeJsonPointer = C.escapeFragment = C.unescapeFragment = C.schemaRefOrVal = C.schemaHasRulesButRef = C.schemaHasRules = C.checkUnknownRules = C.alwaysValidSchema = C.toHash = void 0;
const re = q, mu = rr;
function pu(e) {
  const t = {};
  for (const r of e)
    t[r] = !0;
  return t;
}
C.toHash = pu;
function yu(e, t) {
  return typeof t == "boolean" ? t : Object.keys(t).length === 0 ? !0 : (Xo(e, t), !Yo(t, e.self.RULES.all));
}
C.alwaysValidSchema = yu;
function Xo(e, t = e.schema) {
  const { opts: r, self: n } = e;
  if (!r.strictSchema || typeof t == "boolean")
    return;
  const s = n.RULES.keywords;
  for (const a in t)
    s[a] || Qo(e, `unknown keyword: "${a}"`);
}
C.checkUnknownRules = Xo;
function Yo(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t[r])
      return !0;
  return !1;
}
C.schemaHasRules = Yo;
function $u(e, t) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (r !== "$ref" && t.all[r])
      return !0;
  return !1;
}
C.schemaHasRulesButRef = $u;
function gu({ topSchemaRef: e, schemaPath: t }, r, n, s) {
  if (!s) {
    if (typeof r == "number" || typeof r == "boolean")
      return r;
    if (typeof r == "string")
      return (0, re._)`${r}`;
  }
  return (0, re._)`${e}${t}${(0, re.getProperty)(n)}`;
}
C.schemaRefOrVal = gu;
function vu(e) {
  return Jo(decodeURIComponent(e));
}
C.unescapeFragment = vu;
function _u(e) {
  return encodeURIComponent(fs(e));
}
C.escapeFragment = _u;
function fs(e) {
  return typeof e == "number" ? `${e}` : e.replace(/~/g, "~0").replace(/\//g, "~1");
}
C.escapeJsonPointer = fs;
function Jo(e) {
  return e.replace(/~1/g, "/").replace(/~0/g, "~");
}
C.unescapeJsonPointer = Jo;
function Eu(e, t) {
  if (Array.isArray(e))
    for (const r of e)
      t(r);
  else
    t(e);
}
C.eachItem = Eu;
function ka({ mergeNames: e, mergeToName: t, mergeValues: r, resultToName: n }) {
  return (s, a, o, u) => {
    const i = o === void 0 ? a : o instanceof re.Name ? (a instanceof re.Name ? e(s, a, o) : t(s, a, o), o) : a instanceof re.Name ? (t(s, o, a), a) : r(a, o);
    return u === re.Name && !(i instanceof re.Name) ? n(s, i) : i;
  };
}
C.mergeEvaluated = {
  props: ka({
    mergeNames: (e, t, r) => e.if((0, re._)`${r} !== true && ${t} !== undefined`, () => {
      e.if((0, re._)`${t} === true`, () => e.assign(r, !0), () => e.assign(r, (0, re._)`${r} || {}`).code((0, re._)`Object.assign(${r}, ${t})`));
    }),
    mergeToName: (e, t, r) => e.if((0, re._)`${r} !== true`, () => {
      t === !0 ? e.assign(r, !0) : (e.assign(r, (0, re._)`${r} || {}`), ds(e, r, t));
    }),
    mergeValues: (e, t) => e === !0 ? !0 : { ...e, ...t },
    resultToName: Zo
  }),
  items: ka({
    mergeNames: (e, t, r) => e.if((0, re._)`${r} !== true && ${t} !== undefined`, () => e.assign(r, (0, re._)`${t} === true ? true : ${r} > ${t} ? ${r} : ${t}`)),
    mergeToName: (e, t, r) => e.if((0, re._)`${r} !== true`, () => e.assign(r, t === !0 ? !0 : (0, re._)`${r} > ${t} ? ${r} : ${t}`)),
    mergeValues: (e, t) => e === !0 ? !0 : Math.max(e, t),
    resultToName: (e, t) => e.var("items", t)
  })
};
function Zo(e, t) {
  if (t === !0)
    return e.var("props", !0);
  const r = e.var("props", (0, re._)`{}`);
  return t !== void 0 && ds(e, r, t), r;
}
C.evaluatedPropsToName = Zo;
function ds(e, t, r) {
  Object.keys(r).forEach((n) => e.assign((0, re._)`${t}${(0, re.getProperty)(n)}`, !0));
}
C.setEvaluated = ds;
const Ca = {};
function wu(e, t) {
  return e.scopeValue("func", {
    ref: t,
    code: Ca[t.code] || (Ca[t.code] = new mu._Code(t.code))
  });
}
C.useFunc = wu;
var xn;
(function(e) {
  e[e.Num = 0] = "Num", e[e.Str = 1] = "Str";
})(xn || (C.Type = xn = {}));
function Su(e, t, r) {
  if (e instanceof re.Name) {
    const n = t === xn.Num;
    return r ? n ? (0, re._)`"[" + ${e} + "]"` : (0, re._)`"['" + ${e} + "']"` : n ? (0, re._)`"/" + ${e}` : (0, re._)`"/" + ${e}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
  }
  return r ? (0, re.getProperty)(e).toString() : "/" + fs(e);
}
C.getErrorPath = Su;
function Qo(e, t, r = e.opts.strictSchema) {
  if (r) {
    if (t = `strict mode: ${t}`, r === !0)
      throw new Error(t);
    e.self.logger.warn(t);
  }
}
C.checkStrictMode = Qo;
var Ne = {};
Object.defineProperty(Ne, "__esModule", { value: !0 });
const $e = q, bu = {
  // validation function arguments
  data: new $e.Name("data"),
  // data passed to validation function
  // args passed from referencing schema
  valCxt: new $e.Name("valCxt"),
  // validation/data context - should not be used directly, it is destructured to the names below
  instancePath: new $e.Name("instancePath"),
  parentData: new $e.Name("parentData"),
  parentDataProperty: new $e.Name("parentDataProperty"),
  rootData: new $e.Name("rootData"),
  // root data - same as the data passed to the first/top validation function
  dynamicAnchors: new $e.Name("dynamicAnchors"),
  // used to support recursiveRef and dynamicRef
  // function scoped variables
  vErrors: new $e.Name("vErrors"),
  // null or array of validation errors
  errors: new $e.Name("errors"),
  // counter of validation errors
  this: new $e.Name("this"),
  // "globals"
  self: new $e.Name("self"),
  scope: new $e.Name("scope"),
  // JTD serialize/parse name for JSON string and position
  json: new $e.Name("json"),
  jsonPos: new $e.Name("jsonPos"),
  jsonLen: new $e.Name("jsonLen"),
  jsonPart: new $e.Name("jsonPart")
};
Ne.default = bu;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.extendErrors = e.resetErrorsCount = e.reportExtraError = e.reportError = e.keyword$DataError = e.keywordError = void 0;
  const t = q, r = C, n = Ne;
  e.keywordError = {
    message: ({ keyword: d }) => (0, t.str)`must pass "${d}" keyword validation`
  }, e.keyword$DataError = {
    message: ({ keyword: d, schemaType: m }) => m ? (0, t.str)`"${d}" keyword must be ${m} ($data)` : (0, t.str)`"${d}" keyword is invalid ($data)`
  };
  function s(d, m = e.keywordError, $, P) {
    const { it: R } = d, { gen: I, compositeRule: T, allErrors: V } = R, J = p(d, m, $);
    P ?? (T || V) ? i(I, J) : f(R, (0, t._)`[${J}]`);
  }
  e.reportError = s;
  function a(d, m = e.keywordError, $) {
    const { it: P } = d, { gen: R, compositeRule: I, allErrors: T } = P, V = p(d, m, $);
    i(R, V), I || T || f(P, n.default.vErrors);
  }
  e.reportExtraError = a;
  function o(d, m) {
    d.assign(n.default.errors, m), d.if((0, t._)`${n.default.vErrors} !== null`, () => d.if(m, () => d.assign((0, t._)`${n.default.vErrors}.length`, m), () => d.assign(n.default.vErrors, null)));
  }
  e.resetErrorsCount = o;
  function u({ gen: d, keyword: m, schemaValue: $, data: P, errsCount: R, it: I }) {
    if (R === void 0)
      throw new Error("ajv implementation error");
    const T = d.name("err");
    d.forRange("i", R, n.default.errors, (V) => {
      d.const(T, (0, t._)`${n.default.vErrors}[${V}]`), d.if((0, t._)`${T}.instancePath === undefined`, () => d.assign((0, t._)`${T}.instancePath`, (0, t.strConcat)(n.default.instancePath, I.errorPath))), d.assign((0, t._)`${T}.schemaPath`, (0, t.str)`${I.errSchemaPath}/${m}`), I.opts.verbose && (d.assign((0, t._)`${T}.schema`, $), d.assign((0, t._)`${T}.data`, P));
    });
  }
  e.extendErrors = u;
  function i(d, m) {
    const $ = d.const("err", m);
    d.if((0, t._)`${n.default.vErrors} === null`, () => d.assign(n.default.vErrors, (0, t._)`[${$}]`), (0, t._)`${n.default.vErrors}.push(${$})`), d.code((0, t._)`${n.default.errors}++`);
  }
  function f(d, m) {
    const { gen: $, validateName: P, schemaEnv: R } = d;
    R.$async ? $.throw((0, t._)`new ${d.ValidationError}(${m})`) : ($.assign((0, t._)`${P}.errors`, m), $.return(!1));
  }
  const c = {
    keyword: new t.Name("keyword"),
    schemaPath: new t.Name("schemaPath"),
    // also used in JTD errors
    params: new t.Name("params"),
    propertyName: new t.Name("propertyName"),
    message: new t.Name("message"),
    schema: new t.Name("schema"),
    parentSchema: new t.Name("parentSchema")
  };
  function p(d, m, $) {
    const { createErrors: P } = d.it;
    return P === !1 ? (0, t._)`{}` : w(d, m, $);
  }
  function w(d, m, $ = {}) {
    const { gen: P, it: R } = d, I = [
      y(R, $),
      b(d, $)
    ];
    return _(d, m, I), P.object(...I);
  }
  function y({ errorPath: d }, { instancePath: m }) {
    const $ = m ? (0, t.str)`${d}${(0, r.getErrorPath)(m, r.Type.Str)}` : d;
    return [n.default.instancePath, (0, t.strConcat)(n.default.instancePath, $)];
  }
  function b({ keyword: d, it: { errSchemaPath: m } }, { schemaPath: $, parentSchema: P }) {
    let R = P ? m : (0, t.str)`${m}/${d}`;
    return $ && (R = (0, t.str)`${R}${(0, r.getErrorPath)($, r.Type.Str)}`), [c.schemaPath, R];
  }
  function _(d, { params: m, message: $ }, P) {
    const { keyword: R, data: I, schemaValue: T, it: V } = d, { opts: J, propertyName: ae, topSchemaRef: de, schemaPath: M } = V;
    P.push([c.keyword, R], [c.params, typeof m == "function" ? m(d) : m || (0, t._)`{}`]), J.messages && P.push([c.message, typeof $ == "function" ? $(d) : $]), J.verbose && P.push([c.schema, T], [c.parentSchema, (0, t._)`${de}${M}`], [n.default.data, I]), ae && P.push([c.propertyName, ae]);
  }
})(nr);
Object.defineProperty(Lt, "__esModule", { value: !0 });
Lt.boolOrEmptySchema = Lt.topBoolOrEmptySchema = void 0;
const Pu = nr, Ru = q, Ou = Ne, Iu = {
  message: "boolean schema is false"
};
function Nu(e) {
  const { gen: t, schema: r, validateName: n } = e;
  r === !1 ? ei(e, !1) : typeof r == "object" && r.$async === !0 ? t.return(Ou.default.data) : (t.assign((0, Ru._)`${n}.errors`, null), t.return(!0));
}
Lt.topBoolOrEmptySchema = Nu;
function Tu(e, t) {
  const { gen: r, schema: n } = e;
  n === !1 ? (r.var(t, !1), ei(e)) : r.var(t, !0);
}
Lt.boolOrEmptySchema = Tu;
function ei(e, t) {
  const { gen: r, data: n } = e, s = {
    gen: r,
    keyword: "false schema",
    data: n,
    schema: !1,
    schemaCode: !1,
    schemaValue: !1,
    params: {},
    it: e
  };
  (0, Pu.reportError)(s, Iu, void 0, t);
}
var ue = {}, gt = {};
Object.defineProperty(gt, "__esModule", { value: !0 });
gt.getRules = gt.isJSONType = void 0;
const ju = ["string", "number", "integer", "boolean", "null", "object", "array"], Au = new Set(ju);
function ku(e) {
  return typeof e == "string" && Au.has(e);
}
gt.isJSONType = ku;
function Cu() {
  const e = {
    number: { type: "number", rules: [] },
    string: { type: "string", rules: [] },
    array: { type: "array", rules: [] },
    object: { type: "object", rules: [] }
  };
  return {
    types: { ...e, integer: !0, boolean: !0, null: !0 },
    rules: [{ rules: [] }, e.number, e.string, e.array, e.object],
    post: { rules: [] },
    all: {},
    keywords: {}
  };
}
gt.getRules = Cu;
var He = {};
Object.defineProperty(He, "__esModule", { value: !0 });
He.shouldUseRule = He.shouldUseGroup = He.schemaHasRulesForType = void 0;
function Du({ schema: e, self: t }, r) {
  const n = t.RULES.types[r];
  return n && n !== !0 && ti(e, n);
}
He.schemaHasRulesForType = Du;
function ti(e, t) {
  return t.rules.some((r) => ri(e, r));
}
He.shouldUseGroup = ti;
function ri(e, t) {
  var r;
  return e[t.keyword] !== void 0 || ((r = t.definition.implements) === null || r === void 0 ? void 0 : r.some((n) => e[n] !== void 0));
}
He.shouldUseRule = ri;
Object.defineProperty(ue, "__esModule", { value: !0 });
ue.reportTypeError = ue.checkDataTypes = ue.checkDataType = ue.coerceAndCheckDataType = ue.getJSONTypes = ue.getSchemaTypes = ue.DataType = void 0;
const Lu = gt, Mu = He, Fu = nr, X = q, ni = C;
var At;
(function(e) {
  e[e.Correct = 0] = "Correct", e[e.Wrong = 1] = "Wrong";
})(At || (ue.DataType = At = {}));
function Vu(e) {
  const t = si(e.type);
  if (t.includes("null")) {
    if (e.nullable === !1)
      throw new Error("type: null contradicts nullable: false");
  } else {
    if (!t.length && e.nullable !== void 0)
      throw new Error('"nullable" cannot be used without "type"');
    e.nullable === !0 && t.push("null");
  }
  return t;
}
ue.getSchemaTypes = Vu;
function si(e) {
  const t = Array.isArray(e) ? e : e ? [e] : [];
  if (t.every(Lu.isJSONType))
    return t;
  throw new Error("type must be JSONType or JSONType[]: " + t.join(","));
}
ue.getJSONTypes = si;
function zu(e, t) {
  const { gen: r, data: n, opts: s } = e, a = Uu(t, s.coerceTypes), o = t.length > 0 && !(a.length === 0 && t.length === 1 && (0, Mu.schemaHasRulesForType)(e, t[0]));
  if (o) {
    const u = hs(t, n, s.strictNumbers, At.Wrong);
    r.if(u, () => {
      a.length ? Gu(e, t, a) : ms(e);
    });
  }
  return o;
}
ue.coerceAndCheckDataType = zu;
const ai = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
function Uu(e, t) {
  return t ? e.filter((r) => ai.has(r) || t === "array" && r === "array") : [];
}
function Gu(e, t, r) {
  const { gen: n, data: s, opts: a } = e, o = n.let("dataType", (0, X._)`typeof ${s}`), u = n.let("coerced", (0, X._)`undefined`);
  a.coerceTypes === "array" && n.if((0, X._)`${o} == 'object' && Array.isArray(${s}) && ${s}.length == 1`, () => n.assign(s, (0, X._)`${s}[0]`).assign(o, (0, X._)`typeof ${s}`).if(hs(t, s, a.strictNumbers), () => n.assign(u, s))), n.if((0, X._)`${u} !== undefined`);
  for (const f of r)
    (ai.has(f) || f === "array" && a.coerceTypes === "array") && i(f);
  n.else(), ms(e), n.endIf(), n.if((0, X._)`${u} !== undefined`, () => {
    n.assign(s, u), qu(e, u);
  });
  function i(f) {
    switch (f) {
      case "string":
        n.elseIf((0, X._)`${o} == "number" || ${o} == "boolean"`).assign(u, (0, X._)`"" + ${s}`).elseIf((0, X._)`${s} === null`).assign(u, (0, X._)`""`);
        return;
      case "number":
        n.elseIf((0, X._)`${o} == "boolean" || ${s} === null
              || (${o} == "string" && ${s} && ${s} == +${s})`).assign(u, (0, X._)`+${s}`);
        return;
      case "integer":
        n.elseIf((0, X._)`${o} === "boolean" || ${s} === null
              || (${o} === "string" && ${s} && ${s} == +${s} && !(${s} % 1))`).assign(u, (0, X._)`+${s}`);
        return;
      case "boolean":
        n.elseIf((0, X._)`${s} === "false" || ${s} === 0 || ${s} === null`).assign(u, !1).elseIf((0, X._)`${s} === "true" || ${s} === 1`).assign(u, !0);
        return;
      case "null":
        n.elseIf((0, X._)`${s} === "" || ${s} === 0 || ${s} === false`), n.assign(u, null);
        return;
      case "array":
        n.elseIf((0, X._)`${o} === "string" || ${o} === "number"
              || ${o} === "boolean" || ${s} === null`).assign(u, (0, X._)`[${s}]`);
    }
  }
}
function qu({ gen: e, parentData: t, parentDataProperty: r }, n) {
  e.if((0, X._)`${t} !== undefined`, () => e.assign((0, X._)`${t}[${r}]`, n));
}
function Bn(e, t, r, n = At.Correct) {
  const s = n === At.Correct ? X.operators.EQ : X.operators.NEQ;
  let a;
  switch (e) {
    case "null":
      return (0, X._)`${t} ${s} null`;
    case "array":
      a = (0, X._)`Array.isArray(${t})`;
      break;
    case "object":
      a = (0, X._)`${t} && typeof ${t} == "object" && !Array.isArray(${t})`;
      break;
    case "integer":
      a = o((0, X._)`!(${t} % 1) && !isNaN(${t})`);
      break;
    case "number":
      a = o();
      break;
    default:
      return (0, X._)`typeof ${t} ${s} ${e}`;
  }
  return n === At.Correct ? a : (0, X.not)(a);
  function o(u = X.nil) {
    return (0, X.and)((0, X._)`typeof ${t} == "number"`, u, r ? (0, X._)`isFinite(${t})` : X.nil);
  }
}
ue.checkDataType = Bn;
function hs(e, t, r, n) {
  if (e.length === 1)
    return Bn(e[0], t, r, n);
  let s;
  const a = (0, ni.toHash)(e);
  if (a.array && a.object) {
    const o = (0, X._)`typeof ${t} != "object"`;
    s = a.null ? o : (0, X._)`!${t} || ${o}`, delete a.null, delete a.array, delete a.object;
  } else
    s = X.nil;
  a.number && delete a.integer;
  for (const o in a)
    s = (0, X.and)(s, Bn(o, t, r, n));
  return s;
}
ue.checkDataTypes = hs;
const Ku = {
  message: ({ schema: e }) => `must be ${e}`,
  params: ({ schema: e, schemaValue: t }) => typeof e == "string" ? (0, X._)`{type: ${e}}` : (0, X._)`{type: ${t}}`
};
function ms(e) {
  const t = Hu(e);
  (0, Fu.reportError)(t, Ku);
}
ue.reportTypeError = ms;
function Hu(e) {
  const { gen: t, data: r, schema: n } = e, s = (0, ni.schemaRefOrVal)(e, n, "type");
  return {
    gen: t,
    keyword: "type",
    data: r,
    schema: n.type,
    schemaCode: s,
    schemaValue: s,
    parentSchema: n,
    params: {},
    it: e
  };
}
var xr = {};
Object.defineProperty(xr, "__esModule", { value: !0 });
xr.assignDefaults = void 0;
const St = q, Wu = C;
function xu(e, t) {
  const { properties: r, items: n } = e.schema;
  if (t === "object" && r)
    for (const s in r)
      Da(e, s, r[s].default);
  else
    t === "array" && Array.isArray(n) && n.forEach((s, a) => Da(e, a, s.default));
}
xr.assignDefaults = xu;
function Da(e, t, r) {
  const { gen: n, compositeRule: s, data: a, opts: o } = e;
  if (r === void 0)
    return;
  const u = (0, St._)`${a}${(0, St.getProperty)(t)}`;
  if (s) {
    (0, Wu.checkStrictMode)(e, `default is ignored for: ${u}`);
    return;
  }
  let i = (0, St._)`${u} === undefined`;
  o.useDefaults === "empty" && (i = (0, St._)`${i} || ${u} === null || ${u} === ""`), n.if(i, (0, St._)`${u} = ${(0, St.stringify)(r)}`);
}
var Ue = {}, Y = {};
Object.defineProperty(Y, "__esModule", { value: !0 });
Y.validateUnion = Y.validateArray = Y.usePattern = Y.callValidateCode = Y.schemaProperties = Y.allSchemaProperties = Y.noPropertyInData = Y.propertyInData = Y.isOwnProperty = Y.hasPropFunc = Y.reportMissingProp = Y.checkMissingProp = Y.checkReportMissingProp = void 0;
const ne = q, ps = C, Ze = Ne, Bu = C;
function Xu(e, t) {
  const { gen: r, data: n, it: s } = e;
  r.if($s(r, n, t, s.opts.ownProperties), () => {
    e.setParams({ missingProperty: (0, ne._)`${t}` }, !0), e.error();
  });
}
Y.checkReportMissingProp = Xu;
function Yu({ gen: e, data: t, it: { opts: r } }, n, s) {
  return (0, ne.or)(...n.map((a) => (0, ne.and)($s(e, t, a, r.ownProperties), (0, ne._)`${s} = ${a}`)));
}
Y.checkMissingProp = Yu;
function Ju(e, t) {
  e.setParams({ missingProperty: t }, !0), e.error();
}
Y.reportMissingProp = Ju;
function oi(e) {
  return e.scopeValue("func", {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    ref: Object.prototype.hasOwnProperty,
    code: (0, ne._)`Object.prototype.hasOwnProperty`
  });
}
Y.hasPropFunc = oi;
function ys(e, t, r) {
  return (0, ne._)`${oi(e)}.call(${t}, ${r})`;
}
Y.isOwnProperty = ys;
function Zu(e, t, r, n) {
  const s = (0, ne._)`${t}${(0, ne.getProperty)(r)} !== undefined`;
  return n ? (0, ne._)`${s} && ${ys(e, t, r)}` : s;
}
Y.propertyInData = Zu;
function $s(e, t, r, n) {
  const s = (0, ne._)`${t}${(0, ne.getProperty)(r)} === undefined`;
  return n ? (0, ne.or)(s, (0, ne.not)(ys(e, t, r))) : s;
}
Y.noPropertyInData = $s;
function ii(e) {
  return e ? Object.keys(e).filter((t) => t !== "__proto__") : [];
}
Y.allSchemaProperties = ii;
function Qu(e, t) {
  return ii(t).filter((r) => !(0, ps.alwaysValidSchema)(e, t[r]));
}
Y.schemaProperties = Qu;
function el({ schemaCode: e, data: t, it: { gen: r, topSchemaRef: n, schemaPath: s, errorPath: a }, it: o }, u, i, f) {
  const c = f ? (0, ne._)`${e}, ${t}, ${n}${s}` : t, p = [
    [Ze.default.instancePath, (0, ne.strConcat)(Ze.default.instancePath, a)],
    [Ze.default.parentData, o.parentData],
    [Ze.default.parentDataProperty, o.parentDataProperty],
    [Ze.default.rootData, Ze.default.rootData]
  ];
  o.opts.dynamicRef && p.push([Ze.default.dynamicAnchors, Ze.default.dynamicAnchors]);
  const w = (0, ne._)`${c}, ${r.object(...p)}`;
  return i !== ne.nil ? (0, ne._)`${u}.call(${i}, ${w})` : (0, ne._)`${u}(${w})`;
}
Y.callValidateCode = el;
const tl = (0, ne._)`new RegExp`;
function rl({ gen: e, it: { opts: t } }, r) {
  const n = t.unicodeRegExp ? "u" : "", { regExp: s } = t.code, a = s(r, n);
  return e.scopeValue("pattern", {
    key: a.toString(),
    ref: a,
    code: (0, ne._)`${s.code === "new RegExp" ? tl : (0, Bu.useFunc)(e, s)}(${r}, ${n})`
  });
}
Y.usePattern = rl;
function nl(e) {
  const { gen: t, data: r, keyword: n, it: s } = e, a = t.name("valid");
  if (s.allErrors) {
    const u = t.let("valid", !0);
    return o(() => t.assign(u, !1)), u;
  }
  return t.var(a, !0), o(() => t.break()), a;
  function o(u) {
    const i = t.const("len", (0, ne._)`${r}.length`);
    t.forRange("i", 0, i, (f) => {
      e.subschema({
        keyword: n,
        dataProp: f,
        dataPropType: ps.Type.Num
      }, a), t.if((0, ne.not)(a), u);
    });
  }
}
Y.validateArray = nl;
function sl(e) {
  const { gen: t, schema: r, keyword: n, it: s } = e;
  if (!Array.isArray(r))
    throw new Error("ajv implementation error");
  if (r.some((i) => (0, ps.alwaysValidSchema)(s, i)) && !s.opts.unevaluated)
    return;
  const o = t.let("valid", !1), u = t.name("_valid");
  t.block(() => r.forEach((i, f) => {
    const c = e.subschema({
      keyword: n,
      schemaProp: f,
      compositeRule: !0
    }, u);
    t.assign(o, (0, ne._)`${o} || ${u}`), e.mergeValidEvaluated(c, u) || t.if((0, ne.not)(o));
  })), e.result(o, () => e.reset(), () => e.error(!0));
}
Y.validateUnion = sl;
Object.defineProperty(Ue, "__esModule", { value: !0 });
Ue.validateKeywordUsage = Ue.validSchemaType = Ue.funcKeywordCode = Ue.macroKeywordCode = void 0;
const Ee = q, lt = Ne, al = Y, ol = nr;
function il(e, t) {
  const { gen: r, keyword: n, schema: s, parentSchema: a, it: o } = e, u = t.macro.call(o.self, s, a, o), i = ci(r, n, u);
  o.opts.validateSchema !== !1 && o.self.validateSchema(u, !0);
  const f = r.name("valid");
  e.subschema({
    schema: u,
    schemaPath: Ee.nil,
    errSchemaPath: `${o.errSchemaPath}/${n}`,
    topSchemaRef: i,
    compositeRule: !0
  }, f), e.pass(f, () => e.error(!0));
}
Ue.macroKeywordCode = il;
function cl(e, t) {
  var r;
  const { gen: n, keyword: s, schema: a, parentSchema: o, $data: u, it: i } = e;
  ll(i, t);
  const f = !u && t.compile ? t.compile.call(i.self, a, o, i) : t.validate, c = ci(n, s, f), p = n.let("valid");
  e.block$data(p, w), e.ok((r = t.valid) !== null && r !== void 0 ? r : p);
  function w() {
    if (t.errors === !1)
      _(), t.modifying && La(e), d(() => e.error());
    else {
      const m = t.async ? y() : b();
      t.modifying && La(e), d(() => ul(e, m));
    }
  }
  function y() {
    const m = n.let("ruleErrs", null);
    return n.try(() => _((0, Ee._)`await `), ($) => n.assign(p, !1).if((0, Ee._)`${$} instanceof ${i.ValidationError}`, () => n.assign(m, (0, Ee._)`${$}.errors`), () => n.throw($))), m;
  }
  function b() {
    const m = (0, Ee._)`${c}.errors`;
    return n.assign(m, null), _(Ee.nil), m;
  }
  function _(m = t.async ? (0, Ee._)`await ` : Ee.nil) {
    const $ = i.opts.passContext ? lt.default.this : lt.default.self, P = !("compile" in t && !u || t.schema === !1);
    n.assign(p, (0, Ee._)`${m}${(0, al.callValidateCode)(e, c, $, P)}`, t.modifying);
  }
  function d(m) {
    var $;
    n.if((0, Ee.not)(($ = t.valid) !== null && $ !== void 0 ? $ : p), m);
  }
}
Ue.funcKeywordCode = cl;
function La(e) {
  const { gen: t, data: r, it: n } = e;
  t.if(n.parentData, () => t.assign(r, (0, Ee._)`${n.parentData}[${n.parentDataProperty}]`));
}
function ul(e, t) {
  const { gen: r } = e;
  r.if((0, Ee._)`Array.isArray(${t})`, () => {
    r.assign(lt.default.vErrors, (0, Ee._)`${lt.default.vErrors} === null ? ${t} : ${lt.default.vErrors}.concat(${t})`).assign(lt.default.errors, (0, Ee._)`${lt.default.vErrors}.length`), (0, ol.extendErrors)(e);
  }, () => e.error());
}
function ll({ schemaEnv: e }, t) {
  if (t.async && !e.$async)
    throw new Error("async keyword in sync schema");
}
function ci(e, t, r) {
  if (r === void 0)
    throw new Error(`keyword "${t}" failed to compile`);
  return e.scopeValue("keyword", typeof r == "function" ? { ref: r } : { ref: r, code: (0, Ee.stringify)(r) });
}
function fl(e, t, r = !1) {
  return !t.length || t.some((n) => n === "array" ? Array.isArray(e) : n === "object" ? e && typeof e == "object" && !Array.isArray(e) : typeof e == n || r && typeof e > "u");
}
Ue.validSchemaType = fl;
function dl({ schema: e, opts: t, self: r, errSchemaPath: n }, s, a) {
  if (Array.isArray(s.keyword) ? !s.keyword.includes(a) : s.keyword !== a)
    throw new Error("ajv implementation error");
  const o = s.dependencies;
  if (o != null && o.some((u) => !Object.prototype.hasOwnProperty.call(e, u)))
    throw new Error(`parent schema must have dependencies of ${a}: ${o.join(",")}`);
  if (s.validateSchema && !s.validateSchema(e[a])) {
    const i = `keyword "${a}" value is invalid at path "${n}": ` + r.errorsText(s.validateSchema.errors);
    if (t.validateSchema === "log")
      r.logger.error(i);
    else
      throw new Error(i);
  }
}
Ue.validateKeywordUsage = dl;
var it = {};
Object.defineProperty(it, "__esModule", { value: !0 });
it.extendSubschemaMode = it.extendSubschemaData = it.getSubschema = void 0;
const ze = q, ui = C;
function hl(e, { keyword: t, schemaProp: r, schema: n, schemaPath: s, errSchemaPath: a, topSchemaRef: o }) {
  if (t !== void 0 && n !== void 0)
    throw new Error('both "keyword" and "schema" passed, only one allowed');
  if (t !== void 0) {
    const u = e.schema[t];
    return r === void 0 ? {
      schema: u,
      schemaPath: (0, ze._)`${e.schemaPath}${(0, ze.getProperty)(t)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}`
    } : {
      schema: u[r],
      schemaPath: (0, ze._)`${e.schemaPath}${(0, ze.getProperty)(t)}${(0, ze.getProperty)(r)}`,
      errSchemaPath: `${e.errSchemaPath}/${t}/${(0, ui.escapeFragment)(r)}`
    };
  }
  if (n !== void 0) {
    if (s === void 0 || a === void 0 || o === void 0)
      throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
    return {
      schema: n,
      schemaPath: s,
      topSchemaRef: o,
      errSchemaPath: a
    };
  }
  throw new Error('either "keyword" or "schema" must be passed');
}
it.getSubschema = hl;
function ml(e, t, { dataProp: r, dataPropType: n, data: s, dataTypes: a, propertyName: o }) {
  if (s !== void 0 && r !== void 0)
    throw new Error('both "data" and "dataProp" passed, only one allowed');
  const { gen: u } = t;
  if (r !== void 0) {
    const { errorPath: f, dataPathArr: c, opts: p } = t, w = u.let("data", (0, ze._)`${t.data}${(0, ze.getProperty)(r)}`, !0);
    i(w), e.errorPath = (0, ze.str)`${f}${(0, ui.getErrorPath)(r, n, p.jsPropertySyntax)}`, e.parentDataProperty = (0, ze._)`${r}`, e.dataPathArr = [...c, e.parentDataProperty];
  }
  if (s !== void 0) {
    const f = s instanceof ze.Name ? s : u.let("data", s, !0);
    i(f), o !== void 0 && (e.propertyName = o);
  }
  a && (e.dataTypes = a);
  function i(f) {
    e.data = f, e.dataLevel = t.dataLevel + 1, e.dataTypes = [], t.definedProperties = /* @__PURE__ */ new Set(), e.parentData = t.data, e.dataNames = [...t.dataNames, f];
  }
}
it.extendSubschemaData = ml;
function pl(e, { jtdDiscriminator: t, jtdMetadata: r, compositeRule: n, createErrors: s, allErrors: a }) {
  n !== void 0 && (e.compositeRule = n), s !== void 0 && (e.createErrors = s), a !== void 0 && (e.allErrors = a), e.jtdDiscriminator = t, e.jtdMetadata = r;
}
it.extendSubschemaMode = pl;
var me = {}, li = function e(t, r) {
  if (t === r)
    return !0;
  if (t && r && typeof t == "object" && typeof r == "object") {
    if (t.constructor !== r.constructor)
      return !1;
    var n, s, a;
    if (Array.isArray(t)) {
      if (n = t.length, n != r.length)
        return !1;
      for (s = n; s-- !== 0; )
        if (!e(t[s], r[s]))
          return !1;
      return !0;
    }
    if (t.constructor === RegExp)
      return t.source === r.source && t.flags === r.flags;
    if (t.valueOf !== Object.prototype.valueOf)
      return t.valueOf() === r.valueOf();
    if (t.toString !== Object.prototype.toString)
      return t.toString() === r.toString();
    if (a = Object.keys(t), n = a.length, n !== Object.keys(r).length)
      return !1;
    for (s = n; s-- !== 0; )
      if (!Object.prototype.hasOwnProperty.call(r, a[s]))
        return !1;
    for (s = n; s-- !== 0; ) {
      var o = a[s];
      if (!e(t[o], r[o]))
        return !1;
    }
    return !0;
  }
  return t !== t && r !== r;
}, fi = { exports: {} }, ot = fi.exports = function(e, t, r) {
  typeof t == "function" && (r = t, t = {}), r = t.cb || r;
  var n = typeof r == "function" ? r : r.pre || function() {
  }, s = r.post || function() {
  };
  Rr(t, n, s, e, "", e);
};
ot.keywords = {
  additionalItems: !0,
  items: !0,
  contains: !0,
  additionalProperties: !0,
  propertyNames: !0,
  not: !0,
  if: !0,
  then: !0,
  else: !0
};
ot.arrayKeywords = {
  items: !0,
  allOf: !0,
  anyOf: !0,
  oneOf: !0
};
ot.propsKeywords = {
  $defs: !0,
  definitions: !0,
  properties: !0,
  patternProperties: !0,
  dependencies: !0
};
ot.skipKeywords = {
  default: !0,
  enum: !0,
  const: !0,
  required: !0,
  maximum: !0,
  minimum: !0,
  exclusiveMaximum: !0,
  exclusiveMinimum: !0,
  multipleOf: !0,
  maxLength: !0,
  minLength: !0,
  pattern: !0,
  format: !0,
  maxItems: !0,
  minItems: !0,
  uniqueItems: !0,
  maxProperties: !0,
  minProperties: !0
};
function Rr(e, t, r, n, s, a, o, u, i, f) {
  if (n && typeof n == "object" && !Array.isArray(n)) {
    t(n, s, a, o, u, i, f);
    for (var c in n) {
      var p = n[c];
      if (Array.isArray(p)) {
        if (c in ot.arrayKeywords)
          for (var w = 0; w < p.length; w++)
            Rr(e, t, r, p[w], s + "/" + c + "/" + w, a, s, c, n, w);
      } else if (c in ot.propsKeywords) {
        if (p && typeof p == "object")
          for (var y in p)
            Rr(e, t, r, p[y], s + "/" + c + "/" + yl(y), a, s, c, n, y);
      } else
        (c in ot.keywords || e.allKeys && !(c in ot.skipKeywords)) && Rr(e, t, r, p, s + "/" + c, a, s, c, n);
    }
    r(n, s, a, o, u, i, f);
  }
}
function yl(e) {
  return e.replace(/~/g, "~0").replace(/\//g, "~1");
}
var $l = fi.exports;
Object.defineProperty(me, "__esModule", { value: !0 });
me.getSchemaRefs = me.resolveUrl = me.normalizeId = me._getFullPath = me.getFullPath = me.inlineRef = void 0;
const gl = C, vl = li, _l = $l, El = /* @__PURE__ */ new Set([
  "type",
  "format",
  "pattern",
  "maxLength",
  "minLength",
  "maxProperties",
  "minProperties",
  "maxItems",
  "minItems",
  "maximum",
  "minimum",
  "uniqueItems",
  "multipleOf",
  "required",
  "enum",
  "const"
]);
function wl(e, t = !0) {
  return typeof e == "boolean" ? !0 : t === !0 ? !Xn(e) : t ? di(e) <= t : !1;
}
me.inlineRef = wl;
const Sl = /* @__PURE__ */ new Set([
  "$ref",
  "$recursiveRef",
  "$recursiveAnchor",
  "$dynamicRef",
  "$dynamicAnchor"
]);
function Xn(e) {
  for (const t in e) {
    if (Sl.has(t))
      return !0;
    const r = e[t];
    if (Array.isArray(r) && r.some(Xn) || typeof r == "object" && Xn(r))
      return !0;
  }
  return !1;
}
function di(e) {
  let t = 0;
  for (const r in e) {
    if (r === "$ref")
      return 1 / 0;
    if (t++, !El.has(r) && (typeof e[r] == "object" && (0, gl.eachItem)(e[r], (n) => t += di(n)), t === 1 / 0))
      return 1 / 0;
  }
  return t;
}
function hi(e, t = "", r) {
  r !== !1 && (t = kt(t));
  const n = e.parse(t);
  return mi(e, n);
}
me.getFullPath = hi;
function mi(e, t) {
  return e.serialize(t).split("#")[0] + "#";
}
me._getFullPath = mi;
const bl = /#\/?$/;
function kt(e) {
  return e ? e.replace(bl, "") : "";
}
me.normalizeId = kt;
function Pl(e, t, r) {
  return r = kt(r), e.resolve(t, r);
}
me.resolveUrl = Pl;
const Rl = /^[a-z_][-a-z0-9._]*$/i;
function Ol(e, t) {
  if (typeof e == "boolean")
    return {};
  const { schemaId: r, uriResolver: n } = this.opts, s = kt(e[r] || t), a = { "": s }, o = hi(n, s, !1), u = {}, i = /* @__PURE__ */ new Set();
  return _l(e, { allKeys: !0 }, (p, w, y, b) => {
    if (b === void 0)
      return;
    const _ = o + w;
    let d = a[b];
    typeof p[r] == "string" && (d = m.call(this, p[r])), $.call(this, p.$anchor), $.call(this, p.$dynamicAnchor), a[w] = d;
    function m(P) {
      const R = this.opts.uriResolver.resolve;
      if (P = kt(d ? R(d, P) : P), i.has(P))
        throw c(P);
      i.add(P);
      let I = this.refs[P];
      return typeof I == "string" && (I = this.refs[I]), typeof I == "object" ? f(p, I.schema, P) : P !== kt(_) && (P[0] === "#" ? (f(p, u[P], P), u[P] = p) : this.refs[P] = _), P;
    }
    function $(P) {
      if (typeof P == "string") {
        if (!Rl.test(P))
          throw new Error(`invalid anchor "${P}"`);
        m.call(this, `#${P}`);
      }
    }
  }), u;
  function f(p, w, y) {
    if (w !== void 0 && !vl(p, w))
      throw c(y);
  }
  function c(p) {
    return new Error(`reference "${p}" resolves to more than one schema`);
  }
}
me.getSchemaRefs = Ol;
Object.defineProperty(Ae, "__esModule", { value: !0 });
Ae.getData = Ae.KeywordCxt = Ae.validateFunctionCode = void 0;
const pi = Lt, Ma = ue, gs = He, Ar = ue, Il = xr, Jt = Ue, In = it, L = q, U = Ne, Nl = me, We = C, Wt = nr;
function Tl(e) {
  if (gi(e) && (vi(e), $i(e))) {
    kl(e);
    return;
  }
  yi(e, () => (0, pi.topBoolOrEmptySchema)(e));
}
Ae.validateFunctionCode = Tl;
function yi({ gen: e, validateName: t, schema: r, schemaEnv: n, opts: s }, a) {
  s.code.es5 ? e.func(t, (0, L._)`${U.default.data}, ${U.default.valCxt}`, n.$async, () => {
    e.code((0, L._)`"use strict"; ${Fa(r, s)}`), Al(e, s), e.code(a);
  }) : e.func(t, (0, L._)`${U.default.data}, ${jl(s)}`, n.$async, () => e.code(Fa(r, s)).code(a));
}
function jl(e) {
  return (0, L._)`{${U.default.instancePath}="", ${U.default.parentData}, ${U.default.parentDataProperty}, ${U.default.rootData}=${U.default.data}${e.dynamicRef ? (0, L._)`, ${U.default.dynamicAnchors}={}` : L.nil}}={}`;
}
function Al(e, t) {
  e.if(U.default.valCxt, () => {
    e.var(U.default.instancePath, (0, L._)`${U.default.valCxt}.${U.default.instancePath}`), e.var(U.default.parentData, (0, L._)`${U.default.valCxt}.${U.default.parentData}`), e.var(U.default.parentDataProperty, (0, L._)`${U.default.valCxt}.${U.default.parentDataProperty}`), e.var(U.default.rootData, (0, L._)`${U.default.valCxt}.${U.default.rootData}`), t.dynamicRef && e.var(U.default.dynamicAnchors, (0, L._)`${U.default.valCxt}.${U.default.dynamicAnchors}`);
  }, () => {
    e.var(U.default.instancePath, (0, L._)`""`), e.var(U.default.parentData, (0, L._)`undefined`), e.var(U.default.parentDataProperty, (0, L._)`undefined`), e.var(U.default.rootData, U.default.data), t.dynamicRef && e.var(U.default.dynamicAnchors, (0, L._)`{}`);
  });
}
function kl(e) {
  const { schema: t, opts: r, gen: n } = e;
  yi(e, () => {
    r.$comment && t.$comment && Ei(e), Fl(e), n.let(U.default.vErrors, null), n.let(U.default.errors, 0), r.unevaluated && Cl(e), _i(e), Ul(e);
  });
}
function Cl(e) {
  const { gen: t, validateName: r } = e;
  e.evaluated = t.const("evaluated", (0, L._)`${r}.evaluated`), t.if((0, L._)`${e.evaluated}.dynamicProps`, () => t.assign((0, L._)`${e.evaluated}.props`, (0, L._)`undefined`)), t.if((0, L._)`${e.evaluated}.dynamicItems`, () => t.assign((0, L._)`${e.evaluated}.items`, (0, L._)`undefined`));
}
function Fa(e, t) {
  const r = typeof e == "object" && e[t.schemaId];
  return r && (t.code.source || t.code.process) ? (0, L._)`/*# sourceURL=${r} */` : L.nil;
}
function Dl(e, t) {
  if (gi(e) && (vi(e), $i(e))) {
    Ll(e, t);
    return;
  }
  (0, pi.boolOrEmptySchema)(e, t);
}
function $i({ schema: e, self: t }) {
  if (typeof e == "boolean")
    return !e;
  for (const r in e)
    if (t.RULES.all[r])
      return !0;
  return !1;
}
function gi(e) {
  return typeof e.schema != "boolean";
}
function Ll(e, t) {
  const { schema: r, gen: n, opts: s } = e;
  s.$comment && r.$comment && Ei(e), Vl(e), zl(e);
  const a = n.const("_errs", U.default.errors);
  _i(e, a), n.var(t, (0, L._)`${a} === ${U.default.errors}`);
}
function vi(e) {
  (0, We.checkUnknownRules)(e), Ml(e);
}
function _i(e, t) {
  if (e.opts.jtd)
    return Va(e, [], !1, t);
  const r = (0, Ma.getSchemaTypes)(e.schema), n = (0, Ma.coerceAndCheckDataType)(e, r);
  Va(e, r, !n, t);
}
function Ml(e) {
  const { schema: t, errSchemaPath: r, opts: n, self: s } = e;
  t.$ref && n.ignoreKeywordsWithRef && (0, We.schemaHasRulesButRef)(t, s.RULES) && s.logger.warn(`$ref: keywords ignored in schema at path "${r}"`);
}
function Fl(e) {
  const { schema: t, opts: r } = e;
  t.default !== void 0 && r.useDefaults && r.strictSchema && (0, We.checkStrictMode)(e, "default is ignored in the schema root");
}
function Vl(e) {
  const t = e.schema[e.opts.schemaId];
  t && (e.baseId = (0, Nl.resolveUrl)(e.opts.uriResolver, e.baseId, t));
}
function zl(e) {
  if (e.schema.$async && !e.schemaEnv.$async)
    throw new Error("async schema in sync schema");
}
function Ei({ gen: e, schemaEnv: t, schema: r, errSchemaPath: n, opts: s }) {
  const a = r.$comment;
  if (s.$comment === !0)
    e.code((0, L._)`${U.default.self}.logger.log(${a})`);
  else if (typeof s.$comment == "function") {
    const o = (0, L.str)`${n}/$comment`, u = e.scopeValue("root", { ref: t.root });
    e.code((0, L._)`${U.default.self}.opts.$comment(${a}, ${o}, ${u}.schema)`);
  }
}
function Ul(e) {
  const { gen: t, schemaEnv: r, validateName: n, ValidationError: s, opts: a } = e;
  r.$async ? t.if((0, L._)`${U.default.errors} === 0`, () => t.return(U.default.data), () => t.throw((0, L._)`new ${s}(${U.default.vErrors})`)) : (t.assign((0, L._)`${n}.errors`, U.default.vErrors), a.unevaluated && Gl(e), t.return((0, L._)`${U.default.errors} === 0`));
}
function Gl({ gen: e, evaluated: t, props: r, items: n }) {
  r instanceof L.Name && e.assign((0, L._)`${t}.props`, r), n instanceof L.Name && e.assign((0, L._)`${t}.items`, n);
}
function Va(e, t, r, n) {
  const { gen: s, schema: a, data: o, allErrors: u, opts: i, self: f } = e, { RULES: c } = f;
  if (a.$ref && (i.ignoreKeywordsWithRef || !(0, We.schemaHasRulesButRef)(a, c))) {
    s.block(() => bi(e, "$ref", c.all.$ref.definition));
    return;
  }
  i.jtd || ql(e, t), s.block(() => {
    for (const w of c.rules)
      p(w);
    p(c.post);
  });
  function p(w) {
    (0, gs.shouldUseGroup)(a, w) && (w.type ? (s.if((0, Ar.checkDataType)(w.type, o, i.strictNumbers)), za(e, w), t.length === 1 && t[0] === w.type && r && (s.else(), (0, Ar.reportTypeError)(e)), s.endIf()) : za(e, w), u || s.if((0, L._)`${U.default.errors} === ${n || 0}`));
  }
}
function za(e, t) {
  const { gen: r, schema: n, opts: { useDefaults: s } } = e;
  s && (0, Il.assignDefaults)(e, t.type), r.block(() => {
    for (const a of t.rules)
      (0, gs.shouldUseRule)(n, a) && bi(e, a.keyword, a.definition, t.type);
  });
}
function ql(e, t) {
  e.schemaEnv.meta || !e.opts.strictTypes || (Kl(e, t), e.opts.allowUnionTypes || Hl(e, t), Wl(e, e.dataTypes));
}
function Kl(e, t) {
  if (t.length) {
    if (!e.dataTypes.length) {
      e.dataTypes = t;
      return;
    }
    t.forEach((r) => {
      wi(e.dataTypes, r) || vs(e, `type "${r}" not allowed by context "${e.dataTypes.join(",")}"`);
    }), Bl(e, t);
  }
}
function Hl(e, t) {
  t.length > 1 && !(t.length === 2 && t.includes("null")) && vs(e, "use allowUnionTypes to allow union type keyword");
}
function Wl(e, t) {
  const r = e.self.RULES.all;
  for (const n in r) {
    const s = r[n];
    if (typeof s == "object" && (0, gs.shouldUseRule)(e.schema, s)) {
      const { type: a } = s.definition;
      a.length && !a.some((o) => xl(t, o)) && vs(e, `missing type "${a.join(",")}" for keyword "${n}"`);
    }
  }
}
function xl(e, t) {
  return e.includes(t) || t === "number" && e.includes("integer");
}
function wi(e, t) {
  return e.includes(t) || t === "integer" && e.includes("number");
}
function Bl(e, t) {
  const r = [];
  for (const n of e.dataTypes)
    wi(t, n) ? r.push(n) : t.includes("integer") && n === "number" && r.push("integer");
  e.dataTypes = r;
}
function vs(e, t) {
  const r = e.schemaEnv.baseId + e.errSchemaPath;
  t += ` at "${r}" (strictTypes)`, (0, We.checkStrictMode)(e, t, e.opts.strictTypes);
}
class Si {
  constructor(t, r, n) {
    if ((0, Jt.validateKeywordUsage)(t, r, n), this.gen = t.gen, this.allErrors = t.allErrors, this.keyword = n, this.data = t.data, this.schema = t.schema[n], this.$data = r.$data && t.opts.$data && this.schema && this.schema.$data, this.schemaValue = (0, We.schemaRefOrVal)(t, this.schema, n, this.$data), this.schemaType = r.schemaType, this.parentSchema = t.schema, this.params = {}, this.it = t, this.def = r, this.$data)
      this.schemaCode = t.gen.const("vSchema", Pi(this.$data, t));
    else if (this.schemaCode = this.schemaValue, !(0, Jt.validSchemaType)(this.schema, r.schemaType, r.allowUndefined))
      throw new Error(`${n} value must be ${JSON.stringify(r.schemaType)}`);
    ("code" in r ? r.trackErrors : r.errors !== !1) && (this.errsCount = t.gen.const("_errs", U.default.errors));
  }
  result(t, r, n) {
    this.failResult((0, L.not)(t), r, n);
  }
  failResult(t, r, n) {
    this.gen.if(t), n ? n() : this.error(), r ? (this.gen.else(), r(), this.allErrors && this.gen.endIf()) : this.allErrors ? this.gen.endIf() : this.gen.else();
  }
  pass(t, r) {
    this.failResult((0, L.not)(t), void 0, r);
  }
  fail(t) {
    if (t === void 0) {
      this.error(), this.allErrors || this.gen.if(!1);
      return;
    }
    this.gen.if(t), this.error(), this.allErrors ? this.gen.endIf() : this.gen.else();
  }
  fail$data(t) {
    if (!this.$data)
      return this.fail(t);
    const { schemaCode: r } = this;
    this.fail((0, L._)`${r} !== undefined && (${(0, L.or)(this.invalid$data(), t)})`);
  }
  error(t, r, n) {
    if (r) {
      this.setParams(r), this._error(t, n), this.setParams({});
      return;
    }
    this._error(t, n);
  }
  _error(t, r) {
    (t ? Wt.reportExtraError : Wt.reportError)(this, this.def.error, r);
  }
  $dataError() {
    (0, Wt.reportError)(this, this.def.$dataError || Wt.keyword$DataError);
  }
  reset() {
    if (this.errsCount === void 0)
      throw new Error('add "trackErrors" to keyword definition');
    (0, Wt.resetErrorsCount)(this.gen, this.errsCount);
  }
  ok(t) {
    this.allErrors || this.gen.if(t);
  }
  setParams(t, r) {
    r ? Object.assign(this.params, t) : this.params = t;
  }
  block$data(t, r, n = L.nil) {
    this.gen.block(() => {
      this.check$data(t, n), r();
    });
  }
  check$data(t = L.nil, r = L.nil) {
    if (!this.$data)
      return;
    const { gen: n, schemaCode: s, schemaType: a, def: o } = this;
    n.if((0, L.or)((0, L._)`${s} === undefined`, r)), t !== L.nil && n.assign(t, !0), (a.length || o.validateSchema) && (n.elseIf(this.invalid$data()), this.$dataError(), t !== L.nil && n.assign(t, !1)), n.else();
  }
  invalid$data() {
    const { gen: t, schemaCode: r, schemaType: n, def: s, it: a } = this;
    return (0, L.or)(o(), u());
    function o() {
      if (n.length) {
        if (!(r instanceof L.Name))
          throw new Error("ajv implementation error");
        const i = Array.isArray(n) ? n : [n];
        return (0, L._)`${(0, Ar.checkDataTypes)(i, r, a.opts.strictNumbers, Ar.DataType.Wrong)}`;
      }
      return L.nil;
    }
    function u() {
      if (s.validateSchema) {
        const i = t.scopeValue("validate$data", { ref: s.validateSchema });
        return (0, L._)`!${i}(${r})`;
      }
      return L.nil;
    }
  }
  subschema(t, r) {
    const n = (0, In.getSubschema)(this.it, t);
    (0, In.extendSubschemaData)(n, this.it, t), (0, In.extendSubschemaMode)(n, t);
    const s = { ...this.it, ...n, items: void 0, props: void 0 };
    return Dl(s, r), s;
  }
  mergeEvaluated(t, r) {
    const { it: n, gen: s } = this;
    n.opts.unevaluated && (n.props !== !0 && t.props !== void 0 && (n.props = We.mergeEvaluated.props(s, t.props, n.props, r)), n.items !== !0 && t.items !== void 0 && (n.items = We.mergeEvaluated.items(s, t.items, n.items, r)));
  }
  mergeValidEvaluated(t, r) {
    const { it: n, gen: s } = this;
    if (n.opts.unevaluated && (n.props !== !0 || n.items !== !0))
      return s.if(r, () => this.mergeEvaluated(t, L.Name)), !0;
  }
}
Ae.KeywordCxt = Si;
function bi(e, t, r, n) {
  const s = new Si(e, r, t);
  "code" in r ? r.code(s, n) : s.$data && r.validate ? (0, Jt.funcKeywordCode)(s, r) : "macro" in r ? (0, Jt.macroKeywordCode)(s, r) : (r.compile || r.validate) && (0, Jt.funcKeywordCode)(s, r);
}
const Xl = /^\/(?:[^~]|~0|~1)*$/, Yl = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
function Pi(e, { dataLevel: t, dataNames: r, dataPathArr: n }) {
  let s, a;
  if (e === "")
    return U.default.rootData;
  if (e[0] === "/") {
    if (!Xl.test(e))
      throw new Error(`Invalid JSON-pointer: ${e}`);
    s = e, a = U.default.rootData;
  } else {
    const f = Yl.exec(e);
    if (!f)
      throw new Error(`Invalid JSON-pointer: ${e}`);
    const c = +f[1];
    if (s = f[2], s === "#") {
      if (c >= t)
        throw new Error(i("property/index", c));
      return n[t - c];
    }
    if (c > t)
      throw new Error(i("data", c));
    if (a = r[t - c], !s)
      return a;
  }
  let o = a;
  const u = s.split("/");
  for (const f of u)
    f && (a = (0, L._)`${a}${(0, L.getProperty)((0, We.unescapeJsonPointer)(f))}`, o = (0, L._)`${o} && ${a}`);
  return o;
  function i(f, c) {
    return `Cannot access ${f} ${c} levels up, current level is ${t}`;
  }
}
Ae.getData = Pi;
var Ft = {};
Object.defineProperty(Ft, "__esModule", { value: !0 });
class Jl extends Error {
  constructor(t) {
    super("validation failed"), this.errors = t, this.ajv = this.validation = !0;
  }
}
Ft.default = Jl;
var Et = {};
Object.defineProperty(Et, "__esModule", { value: !0 });
const Nn = me;
class Zl extends Error {
  constructor(t, r, n, s) {
    super(s || `can't resolve reference ${n} from id ${r}`), this.missingRef = (0, Nn.resolveUrl)(t, r, n), this.missingSchema = (0, Nn.normalizeId)((0, Nn.getFullPath)(t, this.missingRef));
  }
}
Et.default = Zl;
var we = {};
Object.defineProperty(we, "__esModule", { value: !0 });
we.resolveSchema = we.getCompilingSchema = we.resolveRef = we.compileSchema = we.SchemaEnv = void 0;
const ke = q, Ql = Ft, ut = Ne, De = me, Ua = C, ef = Ae;
class Br {
  constructor(t) {
    var r;
    this.refs = {}, this.dynamicAnchors = {};
    let n;
    typeof t.schema == "object" && (n = t.schema), this.schema = t.schema, this.schemaId = t.schemaId, this.root = t.root || this, this.baseId = (r = t.baseId) !== null && r !== void 0 ? r : (0, De.normalizeId)(n == null ? void 0 : n[t.schemaId || "$id"]), this.schemaPath = t.schemaPath, this.localRefs = t.localRefs, this.meta = t.meta, this.$async = n == null ? void 0 : n.$async, this.refs = {};
  }
}
we.SchemaEnv = Br;
function _s(e) {
  const t = Ri.call(this, e);
  if (t)
    return t;
  const r = (0, De.getFullPath)(this.opts.uriResolver, e.root.baseId), { es5: n, lines: s } = this.opts.code, { ownProperties: a } = this.opts, o = new ke.CodeGen(this.scope, { es5: n, lines: s, ownProperties: a });
  let u;
  e.$async && (u = o.scopeValue("Error", {
    ref: Ql.default,
    code: (0, ke._)`require("ajv/dist/runtime/validation_error").default`
  }));
  const i = o.scopeName("validate");
  e.validateName = i;
  const f = {
    gen: o,
    allErrors: this.opts.allErrors,
    data: ut.default.data,
    parentData: ut.default.parentData,
    parentDataProperty: ut.default.parentDataProperty,
    dataNames: [ut.default.data],
    dataPathArr: [ke.nil],
    // TODO can its length be used as dataLevel if nil is removed?
    dataLevel: 0,
    dataTypes: [],
    definedProperties: /* @__PURE__ */ new Set(),
    topSchemaRef: o.scopeValue("schema", this.opts.code.source === !0 ? { ref: e.schema, code: (0, ke.stringify)(e.schema) } : { ref: e.schema }),
    validateName: i,
    ValidationError: u,
    schema: e.schema,
    schemaEnv: e,
    rootId: r,
    baseId: e.baseId || r,
    schemaPath: ke.nil,
    errSchemaPath: e.schemaPath || (this.opts.jtd ? "" : "#"),
    errorPath: (0, ke._)`""`,
    opts: this.opts,
    self: this
  };
  let c;
  try {
    this._compilations.add(e), (0, ef.validateFunctionCode)(f), o.optimize(this.opts.code.optimize);
    const p = o.toString();
    c = `${o.scopeRefs(ut.default.scope)}return ${p}`, this.opts.code.process && (c = this.opts.code.process(c, e));
    const y = new Function(`${ut.default.self}`, `${ut.default.scope}`, c)(this, this.scope.get());
    if (this.scope.value(i, { ref: y }), y.errors = null, y.schema = e.schema, y.schemaEnv = e, e.$async && (y.$async = !0), this.opts.code.source === !0 && (y.source = { validateName: i, validateCode: p, scopeValues: o._values }), this.opts.unevaluated) {
      const { props: b, items: _ } = f;
      y.evaluated = {
        props: b instanceof ke.Name ? void 0 : b,
        items: _ instanceof ke.Name ? void 0 : _,
        dynamicProps: b instanceof ke.Name,
        dynamicItems: _ instanceof ke.Name
      }, y.source && (y.source.evaluated = (0, ke.stringify)(y.evaluated));
    }
    return e.validate = y, e;
  } catch (p) {
    throw delete e.validate, delete e.validateName, c && this.logger.error("Error compiling schema, function code:", c), p;
  } finally {
    this._compilations.delete(e);
  }
}
we.compileSchema = _s;
function tf(e, t, r) {
  var n;
  r = (0, De.resolveUrl)(this.opts.uriResolver, t, r);
  const s = e.refs[r];
  if (s)
    return s;
  let a = sf.call(this, e, r);
  if (a === void 0) {
    const o = (n = e.localRefs) === null || n === void 0 ? void 0 : n[r], { schemaId: u } = this.opts;
    o && (a = new Br({ schema: o, schemaId: u, root: e, baseId: t }));
  }
  if (a !== void 0)
    return e.refs[r] = rf.call(this, a);
}
we.resolveRef = tf;
function rf(e) {
  return (0, De.inlineRef)(e.schema, this.opts.inlineRefs) ? e.schema : e.validate ? e : _s.call(this, e);
}
function Ri(e) {
  for (const t of this._compilations)
    if (nf(t, e))
      return t;
}
we.getCompilingSchema = Ri;
function nf(e, t) {
  return e.schema === t.schema && e.root === t.root && e.baseId === t.baseId;
}
function sf(e, t) {
  let r;
  for (; typeof (r = this.refs[t]) == "string"; )
    t = r;
  return r || this.schemas[t] || Xr.call(this, e, t);
}
function Xr(e, t) {
  const r = this.opts.uriResolver.parse(t), n = (0, De._getFullPath)(this.opts.uriResolver, r);
  let s = (0, De.getFullPath)(this.opts.uriResolver, e.baseId, void 0);
  if (Object.keys(e.schema).length > 0 && n === s)
    return Tn.call(this, r, e);
  const a = (0, De.normalizeId)(n), o = this.refs[a] || this.schemas[a];
  if (typeof o == "string") {
    const u = Xr.call(this, e, o);
    return typeof (u == null ? void 0 : u.schema) != "object" ? void 0 : Tn.call(this, r, u);
  }
  if (typeof (o == null ? void 0 : o.schema) == "object") {
    if (o.validate || _s.call(this, o), a === (0, De.normalizeId)(t)) {
      const { schema: u } = o, { schemaId: i } = this.opts, f = u[i];
      return f && (s = (0, De.resolveUrl)(this.opts.uriResolver, s, f)), new Br({ schema: u, schemaId: i, root: e, baseId: s });
    }
    return Tn.call(this, r, o);
  }
}
we.resolveSchema = Xr;
const af = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "enum",
  "dependencies",
  "definitions"
]);
function Tn(e, { baseId: t, schema: r, root: n }) {
  var s;
  if (((s = e.fragment) === null || s === void 0 ? void 0 : s[0]) !== "/")
    return;
  for (const u of e.fragment.slice(1).split("/")) {
    if (typeof r == "boolean")
      return;
    const i = r[(0, Ua.unescapeFragment)(u)];
    if (i === void 0)
      return;
    r = i;
    const f = typeof r == "object" && r[this.opts.schemaId];
    !af.has(u) && f && (t = (0, De.resolveUrl)(this.opts.uriResolver, t, f));
  }
  let a;
  if (typeof r != "boolean" && r.$ref && !(0, Ua.schemaHasRulesButRef)(r, this.RULES)) {
    const u = (0, De.resolveUrl)(this.opts.uriResolver, t, r.$ref);
    a = Xr.call(this, n, u);
  }
  const { schemaId: o } = this.opts;
  if (a = a || new Br({ schema: r, schemaId: o, root: n, baseId: t }), a.schema !== a.root.schema)
    return a;
}
const of = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#", cf = "Meta-schema for $data reference (JSON AnySchema extension proposal)", uf = "object", lf = [
  "$data"
], ff = {
  $data: {
    type: "string",
    anyOf: [
      {
        format: "relative-json-pointer"
      },
      {
        format: "json-pointer"
      }
    ]
  }
}, df = !1, hf = {
  $id: of,
  description: cf,
  type: uf,
  required: lf,
  properties: ff,
  additionalProperties: df
};
var Es = {}, Yr = { exports: {} };
const mf = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu), Oi = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u), ws = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu), Ii = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu), pf = RegExp.prototype.test.bind(/^[\da-z\-._~!$&'()*+,;=:@/]$/iu);
function Ni(e) {
  let t = "", r = 0, n = 0;
  for (n = 0; n < e.length; n++)
    if (r = e[n].charCodeAt(0), r !== 48) {
      if (!(r >= 48 && r <= 57 || r >= 65 && r <= 70 || r >= 97 && r <= 102))
        return "";
      t += e[n];
      break;
    }
  for (n += 1; n < e.length; n++) {
    if (r = e[n].charCodeAt(0), !(r >= 48 && r <= 57 || r >= 65 && r <= 70 || r >= 97 && r <= 102))
      return "";
    t += e[n];
  }
  return t;
}
const yf = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
function Ga(e) {
  return e.length = 0, !0;
}
function $f(e, t, r) {
  if (e.length) {
    const n = Ni(e);
    if (n !== "")
      t.push(n);
    else
      return r.error = !0, !1;
    e.length = 0;
  }
  return !0;
}
function gf(e) {
  let t = 0;
  const r = { error: !1, address: "", zone: "" }, n = [], s = [];
  let a = !1, o = !1, u = $f;
  for (let i = 0; i < e.length; i++) {
    const f = e[i];
    if (!(f === "[" || f === "]"))
      if (f === ":") {
        if (a === !0 && (o = !0), !u(s, n, r))
          break;
        if (++t > 7) {
          r.error = !0;
          break;
        }
        i > 0 && e[i - 1] === ":" && (a = !0), n.push(":");
        continue;
      } else if (f === "%") {
        if (!u(s, n, r))
          break;
        u = Ga;
      } else {
        s.push(f);
        continue;
      }
  }
  return s.length && (u === Ga ? r.zone = s.join("") : o ? n.push(s.join("")) : n.push(Ni(s))), r.address = n.join(""), r;
}
function Ti(e) {
  if (vf(e, ":") < 2)
    return { host: e, isIPV6: !1 };
  const t = gf(e);
  if (t.error)
    return { host: e, isIPV6: !1 };
  {
    let r = t.address, n = t.address;
    return t.zone && (r += "%" + t.zone, n += "%25" + t.zone), { host: r, isIPV6: !0, escapedHost: n };
  }
}
function vf(e, t) {
  let r = 0;
  for (let n = 0; n < e.length; n++)
    e[n] === t && r++;
  return r;
}
function _f(e) {
  let t = e;
  const r = [];
  let n = -1, s = 0;
  for (; s = t.length; ) {
    if (s === 1) {
      if (t === ".")
        break;
      if (t === "/") {
        r.push("/");
        break;
      } else {
        r.push(t);
        break;
      }
    } else if (s === 2) {
      if (t[0] === ".") {
        if (t[1] === ".")
          break;
        if (t[1] === "/") {
          t = t.slice(2);
          continue;
        }
      } else if (t[0] === "/" && (t[1] === "." || t[1] === "/")) {
        r.push("/");
        break;
      }
    } else if (s === 3 && t === "/..") {
      r.length !== 0 && r.pop(), r.push("/");
      break;
    }
    if (t[0] === ".") {
      if (t[1] === ".") {
        if (t[2] === "/") {
          t = t.slice(3);
          continue;
        }
      } else if (t[1] === "/") {
        t = t.slice(2);
        continue;
      }
    } else if (t[0] === "/" && t[1] === ".") {
      if (t[2] === "/") {
        t = t.slice(2);
        continue;
      } else if (t[2] === "." && t[3] === "/") {
        t = t.slice(3), r.length !== 0 && r.pop();
        continue;
      }
    }
    if ((n = t.indexOf("/", 1)) === -1) {
      r.push(t);
      break;
    } else
      r.push(t.slice(0, n)), t = t.slice(n);
  }
  return r.join("");
}
const Ef = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" }, wf = /[@/?#:]/g, Sf = /[@/?#]/g;
function ji(e, t) {
  const r = t ? Sf : wf;
  return r.lastIndex = 0, e.replace(r, (n) => Ef[n]);
}
function bf(e, t = !1) {
  if (e.indexOf("%") === -1)
    return e;
  let r = "";
  for (let n = 0; n < e.length; n++) {
    if (e[n] === "%" && n + 2 < e.length) {
      const s = e.slice(n + 1, n + 3);
      if (ws(s)) {
        const a = s.toUpperCase(), o = String.fromCharCode(parseInt(a, 16));
        t && Ii(o) ? r += o : r += "%" + a, n += 2;
        continue;
      }
    }
    r += e[n];
  }
  return r;
}
function Pf(e) {
  let t = "";
  for (let r = 0; r < e.length; r++) {
    if (e[r] === "%" && r + 2 < e.length) {
      const n = e.slice(r + 1, r + 3);
      if (ws(n)) {
        const s = n.toUpperCase(), a = String.fromCharCode(parseInt(s, 16));
        a !== "." && Ii(a) ? t += a : t += "%" + s, r += 2;
        continue;
      }
    }
    pf(e[r]) ? t += e[r] : t += escape(e[r]);
  }
  return t;
}
function Rf(e) {
  let t = "";
  for (let r = 0; r < e.length; r++) {
    if (e[r] === "%" && r + 2 < e.length) {
      const n = e.slice(r + 1, r + 3);
      if (ws(n)) {
        t += "%" + n.toUpperCase(), r += 2;
        continue;
      }
    }
    t += escape(e[r]);
  }
  return t;
}
function Of(e) {
  const t = [];
  if (e.userinfo !== void 0 && (t.push(e.userinfo), t.push("@")), e.host !== void 0) {
    let r = unescape(e.host);
    if (!Oi(r)) {
      const n = Ti(r);
      n.isIPV6 === !0 ? r = `[${n.escapedHost}]` : r = ji(r, !1);
    }
    t.push(r);
  }
  return (typeof e.port == "number" || typeof e.port == "string") && (t.push(":"), t.push(String(e.port))), t.length ? t.join("") : void 0;
}
var Ai = {
  nonSimpleDomain: yf,
  recomposeAuthority: Of,
  reescapeHostDelimiters: ji,
  normalizePercentEncoding: bf,
  normalizePathEncoding: Pf,
  escapePreservingEscapes: Rf,
  removeDotSegments: _f,
  isIPv4: Oi,
  isUUID: mf,
  normalizeIPv6: Ti
};
const { isUUID: If } = Ai, Nf = /([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-.:;=@]|%[\da-f]{2})+)/iu;
function ki(e) {
  return e.secure === !0 ? !0 : e.secure === !1 ? !1 : e.scheme ? e.scheme.length === 3 && (e.scheme[0] === "w" || e.scheme[0] === "W") && (e.scheme[1] === "s" || e.scheme[1] === "S") && (e.scheme[2] === "s" || e.scheme[2] === "S") : !1;
}
function Ci(e) {
  return e.host || (e.error = e.error || "HTTP URIs must have a host."), e;
}
function Di(e) {
  const t = String(e.scheme).toLowerCase() === "https";
  return (e.port === (t ? 443 : 80) || e.port === "") && (e.port = void 0), e.path || (e.path = "/"), e;
}
function Tf(e) {
  return e.secure = ki(e), e.resourceName = (e.path || "/") + (e.query ? "?" + e.query : ""), e.path = void 0, e.query = void 0, e;
}
function jf(e) {
  if ((e.port === (ki(e) ? 443 : 80) || e.port === "") && (e.port = void 0), typeof e.secure == "boolean" && (e.scheme = e.secure ? "wss" : "ws", e.secure = void 0), e.resourceName) {
    const [t, r] = e.resourceName.split("?");
    e.path = t && t !== "/" ? t : void 0, e.query = r, e.resourceName = void 0;
  }
  return e.fragment = void 0, e;
}
function Af(e, t) {
  if (!e.path)
    return e.error = "URN can not be parsed", e;
  const r = e.path.match(Nf);
  if (r) {
    const n = t.scheme || e.scheme || "urn";
    e.nid = r[1].toLowerCase(), e.nss = r[2];
    const s = `${n}:${t.nid || e.nid}`, a = Ss(s);
    e.path = void 0, a && (e = a.parse(e, t));
  } else
    e.error = e.error || "URN can not be parsed.";
  return e;
}
function kf(e, t) {
  if (e.nid === void 0)
    throw new Error("URN without nid cannot be serialized");
  const r = t.scheme || e.scheme || "urn", n = e.nid.toLowerCase(), s = `${r}:${t.nid || n}`, a = Ss(s);
  a && (e = a.serialize(e, t));
  const o = e, u = e.nss;
  return o.path = `${n || t.nid}:${u}`, t.skipEscape = !0, o;
}
function Cf(e, t) {
  const r = e;
  return r.uuid = r.nss, r.nss = void 0, !t.tolerant && (!r.uuid || !If(r.uuid)) && (r.error = r.error || "UUID is not valid."), r;
}
function Df(e) {
  const t = e;
  return t.nss = (e.uuid || "").toLowerCase(), t;
}
const Li = (
  /** @type {SchemeHandler} */
  {
    scheme: "http",
    domainHost: !0,
    parse: Ci,
    serialize: Di
  }
), Lf = (
  /** @type {SchemeHandler} */
  {
    scheme: "https",
    domainHost: Li.domainHost,
    parse: Ci,
    serialize: Di
  }
), Or = (
  /** @type {SchemeHandler} */
  {
    scheme: "ws",
    domainHost: !0,
    parse: Tf,
    serialize: jf
  }
), Mf = (
  /** @type {SchemeHandler} */
  {
    scheme: "wss",
    domainHost: Or.domainHost,
    parse: Or.parse,
    serialize: Or.serialize
  }
), Ff = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn",
    parse: Af,
    serialize: kf,
    skipNormalize: !0
  }
), Vf = (
  /** @type {SchemeHandler} */
  {
    scheme: "urn:uuid",
    parse: Cf,
    serialize: Df,
    skipNormalize: !0
  }
), kr = (
  /** @type {Record<SchemeName, SchemeHandler>} */
  {
    http: Li,
    https: Lf,
    ws: Or,
    wss: Mf,
    urn: Ff,
    "urn:uuid": Vf
  }
);
Object.setPrototypeOf(kr, null);
function Ss(e) {
  return e && (kr[
    /** @type {SchemeName} */
    e
  ] || kr[
    /** @type {SchemeName} */
    e.toLowerCase()
  ]) || void 0;
}
var zf = {
  SCHEMES: kr,
  getSchemeHandler: Ss
};
const { normalizeIPv6: Uf, removeDotSegments: Bt, recomposeAuthority: Gf, normalizePercentEncoding: qf, normalizePathEncoding: Kf, escapePreservingEscapes: Hf, reescapeHostDelimiters: Wf, isIPv4: xf, nonSimpleDomain: Bf } = Ai, { SCHEMES: Xf, getSchemeHandler: Mi } = zf;
function Yf(e, t) {
  return typeof e == "string" ? e = /** @type {T} */
  td(e, t) : typeof e == "object" && (e = /** @type {T} */
  Mt(vt(e, t), t)), e;
}
function Jf(e, t, r) {
  const n = r ? Object.assign({ scheme: "null" }, r) : { scheme: "null" }, s = Fi(Mt(e, n), Mt(t, n), n, !0);
  return n.skipEscape = !0, vt(s, n);
}
function Fi(e, t, r, n) {
  const s = {};
  return n || (e = Mt(vt(e, r), r), t = Mt(vt(t, r), r)), r = r || {}, !r.tolerant && t.scheme ? (s.scheme = t.scheme, s.userinfo = t.userinfo, s.host = t.host, s.port = t.port, s.path = Bt(t.path || ""), s.query = t.query) : (t.userinfo !== void 0 || t.host !== void 0 || t.port !== void 0 ? (s.userinfo = t.userinfo, s.host = t.host, s.port = t.port, s.path = Bt(t.path || ""), s.query = t.query) : (t.path ? (t.path[0] === "/" ? s.path = Bt(t.path) : ((e.userinfo !== void 0 || e.host !== void 0 || e.port !== void 0) && !e.path ? s.path = "/" + t.path : e.path ? s.path = e.path.slice(0, e.path.lastIndexOf("/") + 1) + t.path : s.path = t.path, s.path = Bt(s.path)), s.query = t.query) : (s.path = e.path, t.query !== void 0 ? s.query = t.query : s.query = e.query), s.userinfo = e.userinfo, s.host = e.host, s.port = e.port), s.scheme = e.scheme), s.fragment = t.fragment, s;
}
function Zf(e, t, r) {
  const n = qa(e, r), s = qa(t, r);
  return n !== void 0 && s !== void 0 && n.toLowerCase() === s.toLowerCase();
}
function vt(e, t) {
  const r = {
    host: e.host,
    scheme: e.scheme,
    userinfo: e.userinfo,
    port: e.port,
    path: e.path,
    query: e.query,
    nid: e.nid,
    nss: e.nss,
    uuid: e.uuid,
    fragment: e.fragment,
    reference: e.reference,
    resourceName: e.resourceName,
    secure: e.secure,
    error: ""
  }, n = Object.assign({}, t), s = [], a = Mi(n.scheme || r.scheme);
  a && a.serialize && a.serialize(r, n), r.path !== void 0 && (n.skipEscape ? r.path = qf(r.path) : (r.path = Hf(r.path), r.scheme !== void 0 && (r.path = r.path.split("%3A").join(":")))), n.reference !== "suffix" && r.scheme && s.push(r.scheme, ":");
  const o = Gf(r);
  if (o !== void 0 && (n.reference !== "suffix" && s.push("//"), s.push(o), r.path && r.path[0] !== "/" && s.push("/")), r.path !== void 0) {
    let u = r.path;
    !n.absolutePath && (!a || !a.absolutePath) && (u = Bt(u)), o === void 0 && u[0] === "/" && u[1] === "/" && (u = "/%2F" + u.slice(2)), s.push(u);
  }
  return r.query !== void 0 && s.push("?", r.query), r.fragment !== void 0 && s.push("#", r.fragment), s.join("");
}
const Qf = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
function ed(e, t) {
  if (t[2] !== void 0 && e.path && e.path[0] !== "/")
    return 'URI path must start with "/" when authority is present.';
  if (typeof e.port == "number" && (e.port < 0 || e.port > 65535))
    return "URI port is malformed.";
}
function Vi(e, t) {
  const r = Object.assign({}, t), n = {
    scheme: void 0,
    userinfo: void 0,
    host: "",
    port: void 0,
    path: "",
    query: void 0,
    fragment: void 0
  };
  let s = !1, a = !1;
  r.reference === "suffix" && (r.scheme ? e = r.scheme + ":" + e : e = "//" + e);
  const o = e.match(Qf);
  if (o) {
    n.scheme = o[1], n.userinfo = o[3], n.host = o[4], n.port = parseInt(o[5], 10), n.path = o[6] || "", n.query = o[7], n.fragment = o[8], isNaN(n.port) && (n.port = o[5]);
    const u = ed(n, o);
    if (u !== void 0 && (n.error = n.error || u, s = !0), n.host)
      if (xf(n.host) === !1) {
        const c = Uf(n.host);
        n.host = c.host.toLowerCase(), a = c.isIPV6;
      } else
        a = !0;
    n.scheme === void 0 && n.userinfo === void 0 && n.host === void 0 && n.port === void 0 && n.query === void 0 && !n.path ? n.reference = "same-document" : n.scheme === void 0 ? n.reference = "relative" : n.fragment === void 0 ? n.reference = "absolute" : n.reference = "uri", r.reference && r.reference !== "suffix" && r.reference !== n.reference && (n.error = n.error || "URI is not a " + r.reference + " reference.");
    const i = Mi(r.scheme || n.scheme);
    if (!r.unicodeSupport && (!i || !i.unicodeSupport) && n.host && (r.domainHost || i && i.domainHost) && a === !1 && Bf(n.host))
      try {
        n.host = URL.domainToASCII(n.host.toLowerCase());
      } catch (f) {
        n.error = n.error || "Host's domain name can not be converted to ASCII: " + f;
      }
    if ((!i || i && !i.skipNormalize) && (e.indexOf("%") !== -1 && (n.scheme !== void 0 && (n.scheme = unescape(n.scheme)), n.host !== void 0 && (n.host = Wf(unescape(n.host), a))), n.path && (n.path = Kf(n.path)), n.fragment))
      try {
        n.fragment = encodeURI(decodeURIComponent(n.fragment));
      } catch {
        n.error = n.error || "URI malformed";
      }
    i && i.parse && i.parse(n, r);
  } else
    n.error = n.error || "URI can not be parsed.";
  return { parsed: n, malformedAuthorityOrPort: s };
}
function Mt(e, t) {
  return Vi(e, t).parsed;
}
function td(e, t) {
  return zi(e, t).normalized;
}
function zi(e, t) {
  const { parsed: r, malformedAuthorityOrPort: n } = Vi(e, t);
  return {
    normalized: n ? e : vt(r, t),
    malformedAuthorityOrPort: n
  };
}
function qa(e, t) {
  if (typeof e == "string") {
    const { normalized: r, malformedAuthorityOrPort: n } = zi(e, t);
    return n ? void 0 : r;
  }
  if (typeof e == "object")
    return vt(e, t);
}
const bs = {
  SCHEMES: Xf,
  normalize: Yf,
  resolve: Jf,
  resolveComponent: Fi,
  equal: Zf,
  serialize: vt,
  parse: Mt
};
Yr.exports = bs;
Yr.exports.default = bs;
Yr.exports.fastUri = bs;
var rd = Yr.exports;
Object.defineProperty(Es, "__esModule", { value: !0 });
const Ui = rd;
Ui.code = 'require("ajv/dist/runtime/uri").default';
Es.default = Ui;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.CodeGen = e.Name = e.nil = e.stringify = e.str = e._ = e.KeywordCxt = void 0;
  var t = Ae;
  Object.defineProperty(e, "KeywordCxt", { enumerable: !0, get: function() {
    return t.KeywordCxt;
  } });
  var r = q;
  Object.defineProperty(e, "_", { enumerable: !0, get: function() {
    return r._;
  } }), Object.defineProperty(e, "str", { enumerable: !0, get: function() {
    return r.str;
  } }), Object.defineProperty(e, "stringify", { enumerable: !0, get: function() {
    return r.stringify;
  } }), Object.defineProperty(e, "nil", { enumerable: !0, get: function() {
    return r.nil;
  } }), Object.defineProperty(e, "Name", { enumerable: !0, get: function() {
    return r.Name;
  } }), Object.defineProperty(e, "CodeGen", { enumerable: !0, get: function() {
    return r.CodeGen;
  } });
  const n = Ft, s = Et, a = gt, o = we, u = q, i = me, f = ue, c = C, p = hf, w = Es, y = (O, g) => new RegExp(O, g);
  y.code = "new RegExp";
  const b = ["removeAdditional", "useDefaults", "coerceTypes"], _ = /* @__PURE__ */ new Set([
    "validate",
    "serialize",
    "parse",
    "wrapper",
    "root",
    "schema",
    "keyword",
    "pattern",
    "formats",
    "validate$data",
    "func",
    "obj",
    "Error"
  ]), d = {
    errorDataPath: "",
    format: "`validateFormats: false` can be used instead.",
    nullable: '"nullable" keyword is supported by default.',
    jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
    extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
    missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
    processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
    sourceCode: "Use option `code: {source: true}`",
    strictDefaults: "It is default now, see option `strict`.",
    strictKeywords: "It is default now, see option `strict`.",
    uniqueItems: '"uniqueItems" keyword is always validated.',
    unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
    cache: "Map is used as cache, schema object as key.",
    serialize: "Map is used as cache, schema object as key.",
    ajvErrors: "It is default now."
  }, m = {
    ignoreKeywordsWithRef: "",
    jsPropertySyntax: "",
    unicode: '"minLength"/"maxLength" account for unicode characters by default.'
  }, $ = 200;
  function P(O) {
    var g, S, v, l, h, E, N, j, F, z, W, ee, Q, ie, te, ir, ln, fn, dn, hn, mn, pn, yn, $n, gn;
    const qt = O.strict, vn = (g = O.code) === null || g === void 0 ? void 0 : g.optimize, ga = vn === !0 || vn === void 0 ? 1 : vn || 0, va = (v = (S = O.code) === null || S === void 0 ? void 0 : S.regExp) !== null && v !== void 0 ? v : y, Sc = (l = O.uriResolver) !== null && l !== void 0 ? l : w.default;
    return {
      strictSchema: (E = (h = O.strictSchema) !== null && h !== void 0 ? h : qt) !== null && E !== void 0 ? E : !0,
      strictNumbers: (j = (N = O.strictNumbers) !== null && N !== void 0 ? N : qt) !== null && j !== void 0 ? j : !0,
      strictTypes: (z = (F = O.strictTypes) !== null && F !== void 0 ? F : qt) !== null && z !== void 0 ? z : "log",
      strictTuples: (ee = (W = O.strictTuples) !== null && W !== void 0 ? W : qt) !== null && ee !== void 0 ? ee : "log",
      strictRequired: (ie = (Q = O.strictRequired) !== null && Q !== void 0 ? Q : qt) !== null && ie !== void 0 ? ie : !1,
      code: O.code ? { ...O.code, optimize: ga, regExp: va } : { optimize: ga, regExp: va },
      loopRequired: (te = O.loopRequired) !== null && te !== void 0 ? te : $,
      loopEnum: (ir = O.loopEnum) !== null && ir !== void 0 ? ir : $,
      meta: (ln = O.meta) !== null && ln !== void 0 ? ln : !0,
      messages: (fn = O.messages) !== null && fn !== void 0 ? fn : !0,
      inlineRefs: (dn = O.inlineRefs) !== null && dn !== void 0 ? dn : !0,
      schemaId: (hn = O.schemaId) !== null && hn !== void 0 ? hn : "$id",
      addUsedSchema: (mn = O.addUsedSchema) !== null && mn !== void 0 ? mn : !0,
      validateSchema: (pn = O.validateSchema) !== null && pn !== void 0 ? pn : !0,
      validateFormats: (yn = O.validateFormats) !== null && yn !== void 0 ? yn : !0,
      unicodeRegExp: ($n = O.unicodeRegExp) !== null && $n !== void 0 ? $n : !0,
      int32range: (gn = O.int32range) !== null && gn !== void 0 ? gn : !0,
      uriResolver: Sc
    };
  }
  class R {
    constructor(g = {}) {
      this.schemas = {}, this.refs = {}, this.formats = /* @__PURE__ */ Object.create(null), this._compilations = /* @__PURE__ */ new Set(), this._loading = {}, this._cache = /* @__PURE__ */ new Map(), g = this.opts = { ...g, ...P(g) };
      const { es5: S, lines: v } = this.opts.code;
      this.scope = new u.ValueScope({ scope: {}, prefixes: _, es5: S, lines: v }), this.logger = G(g.logger);
      const l = g.validateFormats;
      g.validateFormats = !1, this.RULES = (0, a.getRules)(), I.call(this, d, g, "NOT SUPPORTED"), I.call(this, m, g, "DEPRECATED", "warn"), this._metaOpts = de.call(this), g.formats && J.call(this), this._addVocabularies(), this._addDefaultMetaSchema(), g.keywords && ae.call(this, g.keywords), typeof g.meta == "object" && this.addMetaSchema(g.meta), V.call(this), g.validateFormats = l;
    }
    _addVocabularies() {
      this.addKeyword("$async");
    }
    _addDefaultMetaSchema() {
      const { $data: g, meta: S, schemaId: v } = this.opts;
      let l = p;
      v === "id" && (l = { ...p }, l.id = l.$id, delete l.$id), S && g && this.addMetaSchema(l, l[v], !1);
    }
    defaultMeta() {
      const { meta: g, schemaId: S } = this.opts;
      return this.opts.defaultMeta = typeof g == "object" ? g[S] || g : void 0;
    }
    validate(g, S) {
      let v;
      if (typeof g == "string") {
        if (v = this.getSchema(g), !v)
          throw new Error(`no schema with key or ref "${g}"`);
      } else
        v = this.compile(g);
      const l = v(S);
      return "$async" in v || (this.errors = v.errors), l;
    }
    compile(g, S) {
      const v = this._addSchema(g, S);
      return v.validate || this._compileSchemaEnv(v);
    }
    compileAsync(g, S) {
      if (typeof this.opts.loadSchema != "function")
        throw new Error("options.loadSchema should be a function");
      const { loadSchema: v } = this.opts;
      return l.call(this, g, S);
      async function l(z, W) {
        await h.call(this, z.$schema);
        const ee = this._addSchema(z, W);
        return ee.validate || E.call(this, ee);
      }
      async function h(z) {
        z && !this.getSchema(z) && await l.call(this, { $ref: z }, !0);
      }
      async function E(z) {
        try {
          return this._compileSchemaEnv(z);
        } catch (W) {
          if (!(W instanceof s.default))
            throw W;
          return N.call(this, W), await j.call(this, W.missingSchema), E.call(this, z);
        }
      }
      function N({ missingSchema: z, missingRef: W }) {
        if (this.refs[z])
          throw new Error(`AnySchema ${z} is loaded but ${W} cannot be resolved`);
      }
      async function j(z) {
        const W = await F.call(this, z);
        this.refs[z] || await h.call(this, W.$schema), this.refs[z] || this.addSchema(W, z, S);
      }
      async function F(z) {
        const W = this._loading[z];
        if (W)
          return W;
        try {
          return await (this._loading[z] = v(z));
        } finally {
          delete this._loading[z];
        }
      }
    }
    // Adds schema to the instance
    addSchema(g, S, v, l = this.opts.validateSchema) {
      if (Array.isArray(g)) {
        for (const E of g)
          this.addSchema(E, void 0, v, l);
        return this;
      }
      let h;
      if (typeof g == "object") {
        const { schemaId: E } = this.opts;
        if (h = g[E], h !== void 0 && typeof h != "string")
          throw new Error(`schema ${E} must be string`);
      }
      return S = (0, i.normalizeId)(S || h), this._checkUnique(S), this.schemas[S] = this._addSchema(g, v, S, l, !0), this;
    }
    // Add schema that will be used to validate other schemas
    // options in META_IGNORE_OPTIONS are alway set to false
    addMetaSchema(g, S, v = this.opts.validateSchema) {
      return this.addSchema(g, S, !0, v), this;
    }
    //  Validate schema against its meta-schema
    validateSchema(g, S) {
      if (typeof g == "boolean")
        return !0;
      let v;
      if (v = g.$schema, v !== void 0 && typeof v != "string")
        throw new Error("$schema must be a string");
      if (v = v || this.opts.defaultMeta || this.defaultMeta(), !v)
        return this.logger.warn("meta-schema not available"), this.errors = null, !0;
      const l = this.validate(v, g);
      if (!l && S) {
        const h = "schema is invalid: " + this.errorsText();
        if (this.opts.validateSchema === "log")
          this.logger.error(h);
        else
          throw new Error(h);
      }
      return l;
    }
    // Get compiled schema by `key` or `ref`.
    // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
    getSchema(g) {
      let S;
      for (; typeof (S = T.call(this, g)) == "string"; )
        g = S;
      if (S === void 0) {
        const { schemaId: v } = this.opts, l = new o.SchemaEnv({ schema: {}, schemaId: v });
        if (S = o.resolveSchema.call(this, l, g), !S)
          return;
        this.refs[g] = S;
      }
      return S.validate || this._compileSchemaEnv(S);
    }
    // Remove cached schema(s).
    // If no parameter is passed all schemas but meta-schemas are removed.
    // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
    // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
    removeSchema(g) {
      if (g instanceof RegExp)
        return this._removeAllSchemas(this.schemas, g), this._removeAllSchemas(this.refs, g), this;
      switch (typeof g) {
        case "undefined":
          return this._removeAllSchemas(this.schemas), this._removeAllSchemas(this.refs), this._cache.clear(), this;
        case "string": {
          const S = T.call(this, g);
          return typeof S == "object" && this._cache.delete(S.schema), delete this.schemas[g], delete this.refs[g], this;
        }
        case "object": {
          const S = g;
          this._cache.delete(S);
          let v = g[this.opts.schemaId];
          return v && (v = (0, i.normalizeId)(v), delete this.schemas[v], delete this.refs[v]), this;
        }
        default:
          throw new Error("ajv.removeSchema: invalid parameter");
      }
    }
    // add "vocabulary" - a collection of keywords
    addVocabulary(g) {
      for (const S of g)
        this.addKeyword(S);
      return this;
    }
    addKeyword(g, S) {
      let v;
      if (typeof g == "string")
        v = g, typeof S == "object" && (this.logger.warn("these parameters are deprecated, see docs for addKeyword"), S.keyword = v);
      else if (typeof g == "object" && S === void 0) {
        if (S = g, v = S.keyword, Array.isArray(v) && !v.length)
          throw new Error("addKeywords: keyword must be string or non-empty array");
      } else
        throw new Error("invalid addKeywords parameters");
      if (K.call(this, v, S), !S)
        return (0, c.eachItem)(v, (h) => oe.call(this, h)), this;
      k.call(this, S);
      const l = {
        ...S,
        type: (0, f.getJSONTypes)(S.type),
        schemaType: (0, f.getJSONTypes)(S.schemaType)
      };
      return (0, c.eachItem)(v, l.type.length === 0 ? (h) => oe.call(this, h, l) : (h) => l.type.forEach((E) => oe.call(this, h, l, E))), this;
    }
    getKeyword(g) {
      const S = this.RULES.all[g];
      return typeof S == "object" ? S.definition : !!S;
    }
    // Remove keyword
    removeKeyword(g) {
      const { RULES: S } = this;
      delete S.keywords[g], delete S.all[g];
      for (const v of S.rules) {
        const l = v.rules.findIndex((h) => h.keyword === g);
        l >= 0 && v.rules.splice(l, 1);
      }
      return this;
    }
    // Add format
    addFormat(g, S) {
      return typeof S == "string" && (S = new RegExp(S)), this.formats[g] = S, this;
    }
    errorsText(g = this.errors, { separator: S = ", ", dataVar: v = "data" } = {}) {
      return !g || g.length === 0 ? "No errors" : g.map((l) => `${v}${l.instancePath} ${l.message}`).reduce((l, h) => l + S + h);
    }
    $dataMetaSchema(g, S) {
      const v = this.RULES.all;
      g = JSON.parse(JSON.stringify(g));
      for (const l of S) {
        const h = l.split("/").slice(1);
        let E = g;
        for (const N of h)
          E = E[N];
        for (const N in v) {
          const j = v[N];
          if (typeof j != "object")
            continue;
          const { $data: F } = j.definition, z = E[N];
          F && z && (E[N] = D(z));
        }
      }
      return g;
    }
    _removeAllSchemas(g, S) {
      for (const v in g) {
        const l = g[v];
        (!S || S.test(v)) && (typeof l == "string" ? delete g[v] : l && !l.meta && (this._cache.delete(l.schema), delete g[v]));
      }
    }
    _addSchema(g, S, v, l = this.opts.validateSchema, h = this.opts.addUsedSchema) {
      let E;
      const { schemaId: N } = this.opts;
      if (typeof g == "object")
        E = g[N];
      else {
        if (this.opts.jtd)
          throw new Error("schema must be object");
        if (typeof g != "boolean")
          throw new Error("schema must be object or boolean");
      }
      let j = this._cache.get(g);
      if (j !== void 0)
        return j;
      v = (0, i.normalizeId)(E || v);
      const F = i.getSchemaRefs.call(this, g, v);
      return j = new o.SchemaEnv({ schema: g, schemaId: N, meta: S, baseId: v, localRefs: F }), this._cache.set(j.schema, j), h && !v.startsWith("#") && (v && this._checkUnique(v), this.refs[v] = j), l && this.validateSchema(g, !0), j;
    }
    _checkUnique(g) {
      if (this.schemas[g] || this.refs[g])
        throw new Error(`schema with key or id "${g}" already exists`);
    }
    _compileSchemaEnv(g) {
      if (g.meta ? this._compileMetaSchema(g) : o.compileSchema.call(this, g), !g.validate)
        throw new Error("ajv implementation error");
      return g.validate;
    }
    _compileMetaSchema(g) {
      const S = this.opts;
      this.opts = this._metaOpts;
      try {
        o.compileSchema.call(this, g);
      } finally {
        this.opts = S;
      }
    }
  }
  R.ValidationError = n.default, R.MissingRefError = s.default, e.default = R;
  function I(O, g, S, v = "error") {
    for (const l in O) {
      const h = l;
      h in g && this.logger[v](`${S}: option ${l}. ${O[h]}`);
    }
  }
  function T(O) {
    return O = (0, i.normalizeId)(O), this.schemas[O] || this.refs[O];
  }
  function V() {
    const O = this.opts.schemas;
    if (O)
      if (Array.isArray(O))
        this.addSchema(O);
      else
        for (const g in O)
          this.addSchema(O[g], g);
  }
  function J() {
    for (const O in this.opts.formats) {
      const g = this.opts.formats[O];
      g && this.addFormat(O, g);
    }
  }
  function ae(O) {
    if (Array.isArray(O)) {
      this.addVocabulary(O);
      return;
    }
    this.logger.warn("keywords option as map is deprecated, pass array");
    for (const g in O) {
      const S = O[g];
      S.keyword || (S.keyword = g), this.addKeyword(S);
    }
  }
  function de() {
    const O = { ...this.opts };
    for (const g of b)
      delete O[g];
    return O;
  }
  const M = { log() {
  }, warn() {
  }, error() {
  } };
  function G(O) {
    if (O === !1)
      return M;
    if (O === void 0)
      return console;
    if (O.log && O.warn && O.error)
      return O;
    throw new Error("logger must implement log, warn and error methods");
  }
  const Z = /^[a-z_$][a-z0-9_$:-]*$/i;
  function K(O, g) {
    const { RULES: S } = this;
    if ((0, c.eachItem)(O, (v) => {
      if (S.keywords[v])
        throw new Error(`Keyword ${v} is already defined`);
      if (!Z.test(v))
        throw new Error(`Keyword ${v} has invalid name`);
    }), !!g && g.$data && !("code" in g || "validate" in g))
      throw new Error('$data keyword must have "code" or "validate" function');
  }
  function oe(O, g, S) {
    var v;
    const l = g == null ? void 0 : g.post;
    if (S && l)
      throw new Error('keyword with "post" flag cannot have "type"');
    const { RULES: h } = this;
    let E = l ? h.post : h.rules.find(({ type: j }) => j === S);
    if (E || (E = { type: S, rules: [] }, h.rules.push(E)), h.keywords[O] = !0, !g)
      return;
    const N = {
      keyword: O,
      definition: {
        ...g,
        type: (0, f.getJSONTypes)(g.type),
        schemaType: (0, f.getJSONTypes)(g.schemaType)
      }
    };
    g.before ? Se.call(this, E, N, g.before) : E.rules.push(N), h.all[O] = N, (v = g.implements) === null || v === void 0 || v.forEach((j) => this.addKeyword(j));
  }
  function Se(O, g, S) {
    const v = O.rules.findIndex((l) => l.keyword === S);
    v >= 0 ? O.rules.splice(v, 0, g) : (O.rules.push(g), this.logger.warn(`rule ${S} is not defined`));
  }
  function k(O) {
    let { metaSchema: g } = O;
    g !== void 0 && (O.$data && this.opts.$data && (g = D(g)), O.validateSchema = this.compile(g, !0));
  }
  const A = {
    $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
  };
  function D(O) {
    return { anyOf: [O, A] };
  }
})(ls);
var Ps = {}, Jr = {}, Rs = {};
Object.defineProperty(Rs, "__esModule", { value: !0 });
const nd = {
  keyword: "id",
  code() {
    throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
  }
};
Rs.default = nd;
var Be = {};
Object.defineProperty(Be, "__esModule", { value: !0 });
Be.callRef = Be.getValidate = void 0;
const sd = Et, Ka = Y, Re = q, bt = Ne, Ha = we, dr = C, ad = {
  keyword: "$ref",
  schemaType: "string",
  code(e) {
    const { gen: t, schema: r, it: n } = e, { baseId: s, schemaEnv: a, validateName: o, opts: u, self: i } = n, { root: f } = a;
    if ((r === "#" || r === "#/") && s === f.baseId)
      return p();
    const c = Ha.resolveRef.call(i, f, s, r);
    if (c === void 0)
      throw new sd.default(n.opts.uriResolver, s, r);
    if (c instanceof Ha.SchemaEnv)
      return w(c);
    return y(c);
    function p() {
      if (a === f)
        return Ir(e, o, a, a.$async);
      const b = t.scopeValue("root", { ref: f });
      return Ir(e, (0, Re._)`${b}.validate`, f, f.$async);
    }
    function w(b) {
      const _ = Gi(e, b);
      Ir(e, _, b, b.$async);
    }
    function y(b) {
      const _ = t.scopeValue("schema", u.code.source === !0 ? { ref: b, code: (0, Re.stringify)(b) } : { ref: b }), d = t.name("valid"), m = e.subschema({
        schema: b,
        dataTypes: [],
        schemaPath: Re.nil,
        topSchemaRef: _,
        errSchemaPath: r
      }, d);
      e.mergeEvaluated(m), e.ok(d);
    }
  }
};
function Gi(e, t) {
  const { gen: r } = e;
  return t.validate ? r.scopeValue("validate", { ref: t.validate }) : (0, Re._)`${r.scopeValue("wrapper", { ref: t })}.validate`;
}
Be.getValidate = Gi;
function Ir(e, t, r, n) {
  const { gen: s, it: a } = e, { allErrors: o, schemaEnv: u, opts: i } = a, f = i.passContext ? bt.default.this : Re.nil;
  n ? c() : p();
  function c() {
    if (!u.$async)
      throw new Error("async schema referenced by sync schema");
    const b = s.let("valid");
    s.try(() => {
      s.code((0, Re._)`await ${(0, Ka.callValidateCode)(e, t, f)}`), y(t), o || s.assign(b, !0);
    }, (_) => {
      s.if((0, Re._)`!(${_} instanceof ${a.ValidationError})`, () => s.throw(_)), w(_), o || s.assign(b, !1);
    }), e.ok(b);
  }
  function p() {
    e.result((0, Ka.callValidateCode)(e, t, f), () => y(t), () => w(t));
  }
  function w(b) {
    const _ = (0, Re._)`${b}.errors`;
    s.assign(bt.default.vErrors, (0, Re._)`${bt.default.vErrors} === null ? ${_} : ${bt.default.vErrors}.concat(${_})`), s.assign(bt.default.errors, (0, Re._)`${bt.default.vErrors}.length`);
  }
  function y(b) {
    var _;
    if (!a.opts.unevaluated)
      return;
    const d = (_ = r == null ? void 0 : r.validate) === null || _ === void 0 ? void 0 : _.evaluated;
    if (a.props !== !0)
      if (d && !d.dynamicProps)
        d.props !== void 0 && (a.props = dr.mergeEvaluated.props(s, d.props, a.props));
      else {
        const m = s.var("props", (0, Re._)`${b}.evaluated.props`);
        a.props = dr.mergeEvaluated.props(s, m, a.props, Re.Name);
      }
    if (a.items !== !0)
      if (d && !d.dynamicItems)
        d.items !== void 0 && (a.items = dr.mergeEvaluated.items(s, d.items, a.items));
      else {
        const m = s.var("items", (0, Re._)`${b}.evaluated.items`);
        a.items = dr.mergeEvaluated.items(s, m, a.items, Re.Name);
      }
  }
}
Be.callRef = Ir;
Be.default = ad;
Object.defineProperty(Jr, "__esModule", { value: !0 });
const od = Rs, id = Be, cd = [
  "$schema",
  "$id",
  "$defs",
  "$vocabulary",
  { keyword: "$comment" },
  "definitions",
  od.default,
  id.default
];
Jr.default = cd;
var Zr = {}, Os = {};
Object.defineProperty(Os, "__esModule", { value: !0 });
const Cr = q, Qe = Cr.operators, Dr = {
  maximum: { okStr: "<=", ok: Qe.LTE, fail: Qe.GT },
  minimum: { okStr: ">=", ok: Qe.GTE, fail: Qe.LT },
  exclusiveMaximum: { okStr: "<", ok: Qe.LT, fail: Qe.GTE },
  exclusiveMinimum: { okStr: ">", ok: Qe.GT, fail: Qe.LTE }
}, ud = {
  message: ({ keyword: e, schemaCode: t }) => (0, Cr.str)`must be ${Dr[e].okStr} ${t}`,
  params: ({ keyword: e, schemaCode: t }) => (0, Cr._)`{comparison: ${Dr[e].okStr}, limit: ${t}}`
}, ld = {
  keyword: Object.keys(Dr),
  type: "number",
  schemaType: "number",
  $data: !0,
  error: ud,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e;
    e.fail$data((0, Cr._)`${r} ${Dr[t].fail} ${n} || isNaN(${r})`);
  }
};
Os.default = ld;
var Is = {};
Object.defineProperty(Is, "__esModule", { value: !0 });
const Zt = q, fd = {
  message: ({ schemaCode: e }) => (0, Zt.str)`must be multiple of ${e}`,
  params: ({ schemaCode: e }) => (0, Zt._)`{multipleOf: ${e}}`
}, dd = {
  keyword: "multipleOf",
  type: "number",
  schemaType: "number",
  $data: !0,
  error: fd,
  code(e) {
    const { gen: t, data: r, schemaCode: n, it: s } = e, a = s.opts.multipleOfPrecision, o = t.let("res"), u = a ? (0, Zt._)`Math.abs(Math.round(${o}) - ${o}) > 1e-${a}` : (0, Zt._)`${o} !== parseInt(${o})`;
    e.fail$data((0, Zt._)`(${n} === 0 || (${o} = ${r}/${n}, ${u}))`);
  }
};
Is.default = dd;
var Ns = {}, Ts = {};
Object.defineProperty(Ts, "__esModule", { value: !0 });
function qi(e) {
  const t = e.length;
  let r = 0, n = 0, s;
  for (; n < t; )
    r++, s = e.charCodeAt(n++), s >= 55296 && s <= 56319 && n < t && (s = e.charCodeAt(n), (s & 64512) === 56320 && n++);
  return r;
}
Ts.default = qi;
qi.code = 'require("ajv/dist/runtime/ucs2length").default';
Object.defineProperty(Ns, "__esModule", { value: !0 });
const ft = q, hd = C, md = Ts, pd = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxLength" ? "more" : "fewer";
    return (0, ft.str)`must NOT have ${r} than ${t} characters`;
  },
  params: ({ schemaCode: e }) => (0, ft._)`{limit: ${e}}`
}, yd = {
  keyword: ["maxLength", "minLength"],
  type: "string",
  schemaType: "number",
  $data: !0,
  error: pd,
  code(e) {
    const { keyword: t, data: r, schemaCode: n, it: s } = e, a = t === "maxLength" ? ft.operators.GT : ft.operators.LT, o = s.opts.unicode === !1 ? (0, ft._)`${r}.length` : (0, ft._)`${(0, hd.useFunc)(e.gen, md.default)}(${r})`;
    e.fail$data((0, ft._)`${o} ${a} ${n}`);
  }
};
Ns.default = yd;
var js = {};
Object.defineProperty(js, "__esModule", { value: !0 });
const $d = Y, gd = C, Tt = q, vd = {
  message: ({ schemaCode: e }) => (0, Tt.str)`must match pattern "${e}"`,
  params: ({ schemaCode: e }) => (0, Tt._)`{pattern: ${e}}`
}, _d = {
  keyword: "pattern",
  type: "string",
  schemaType: "string",
  $data: !0,
  error: vd,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, schemaCode: a, it: o } = e, u = o.opts.unicodeRegExp ? "u" : "";
    if (n) {
      const { regExp: i } = o.opts.code, f = i.code === "new RegExp" ? (0, Tt._)`new RegExp` : (0, gd.useFunc)(t, i), c = t.let("valid");
      t.try(() => t.assign(c, (0, Tt._)`${f}(${a}, ${u}).test(${r})`), () => t.assign(c, !1)), e.fail$data((0, Tt._)`!${c}`);
    } else {
      const i = (0, $d.usePattern)(e, s);
      e.fail$data((0, Tt._)`!${i}.test(${r})`);
    }
  }
};
js.default = _d;
var As = {};
Object.defineProperty(As, "__esModule", { value: !0 });
const Qt = q, Ed = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxProperties" ? "more" : "fewer";
    return (0, Qt.str)`must NOT have ${r} than ${t} properties`;
  },
  params: ({ schemaCode: e }) => (0, Qt._)`{limit: ${e}}`
}, wd = {
  keyword: ["maxProperties", "minProperties"],
  type: "object",
  schemaType: "number",
  $data: !0,
  error: Ed,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxProperties" ? Qt.operators.GT : Qt.operators.LT;
    e.fail$data((0, Qt._)`Object.keys(${r}).length ${s} ${n}`);
  }
};
As.default = wd;
var ks = {};
Object.defineProperty(ks, "__esModule", { value: !0 });
const xt = Y, er = q, Sd = C, bd = {
  message: ({ params: { missingProperty: e } }) => (0, er.str)`must have required property '${e}'`,
  params: ({ params: { missingProperty: e } }) => (0, er._)`{missingProperty: ${e}}`
}, Pd = {
  keyword: "required",
  type: "object",
  schemaType: "array",
  $data: !0,
  error: bd,
  code(e) {
    const { gen: t, schema: r, schemaCode: n, data: s, $data: a, it: o } = e, { opts: u } = o;
    if (!a && r.length === 0)
      return;
    const i = r.length >= u.loopRequired;
    if (o.allErrors ? f() : c(), u.strictRequired) {
      const y = e.parentSchema.properties, { definedProperties: b } = e.it;
      for (const _ of r)
        if ((y == null ? void 0 : y[_]) === void 0 && !b.has(_)) {
          const d = o.schemaEnv.baseId + o.errSchemaPath, m = `required property "${_}" is not defined at "${d}" (strictRequired)`;
          (0, Sd.checkStrictMode)(o, m, o.opts.strictRequired);
        }
    }
    function f() {
      if (i || a)
        e.block$data(er.nil, p);
      else
        for (const y of r)
          (0, xt.checkReportMissingProp)(e, y);
    }
    function c() {
      const y = t.let("missing");
      if (i || a) {
        const b = t.let("valid", !0);
        e.block$data(b, () => w(y, b)), e.ok(b);
      } else
        t.if((0, xt.checkMissingProp)(e, r, y)), (0, xt.reportMissingProp)(e, y), t.else();
    }
    function p() {
      t.forOf("prop", n, (y) => {
        e.setParams({ missingProperty: y }), t.if((0, xt.noPropertyInData)(t, s, y, u.ownProperties), () => e.error());
      });
    }
    function w(y, b) {
      e.setParams({ missingProperty: y }), t.forOf(y, n, () => {
        t.assign(b, (0, xt.propertyInData)(t, s, y, u.ownProperties)), t.if((0, er.not)(b), () => {
          e.error(), t.break();
        });
      }, er.nil);
    }
  }
};
ks.default = Pd;
var Cs = {};
Object.defineProperty(Cs, "__esModule", { value: !0 });
const tr = q, Rd = {
  message({ keyword: e, schemaCode: t }) {
    const r = e === "maxItems" ? "more" : "fewer";
    return (0, tr.str)`must NOT have ${r} than ${t} items`;
  },
  params: ({ schemaCode: e }) => (0, tr._)`{limit: ${e}}`
}, Od = {
  keyword: ["maxItems", "minItems"],
  type: "array",
  schemaType: "number",
  $data: !0,
  error: Rd,
  code(e) {
    const { keyword: t, data: r, schemaCode: n } = e, s = t === "maxItems" ? tr.operators.GT : tr.operators.LT;
    e.fail$data((0, tr._)`${r}.length ${s} ${n}`);
  }
};
Cs.default = Od;
var Ds = {}, sr = {};
Object.defineProperty(sr, "__esModule", { value: !0 });
const Ki = li;
Ki.code = 'require("ajv/dist/runtime/equal").default';
sr.default = Ki;
Object.defineProperty(Ds, "__esModule", { value: !0 });
const jn = ue, he = q, Id = C, Nd = sr, Td = {
  message: ({ params: { i: e, j: t } }) => (0, he.str)`must NOT have duplicate items (items ## ${t} and ${e} are identical)`,
  params: ({ params: { i: e, j: t } }) => (0, he._)`{i: ${e}, j: ${t}}`
}, jd = {
  keyword: "uniqueItems",
  type: "array",
  schemaType: "boolean",
  $data: !0,
  error: Td,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, parentSchema: a, schemaCode: o, it: u } = e;
    if (!n && !s)
      return;
    const i = t.let("valid"), f = a.items ? (0, jn.getSchemaTypes)(a.items) : [];
    e.block$data(i, c, (0, he._)`${o} === false`), e.ok(i);
    function c() {
      const b = t.let("i", (0, he._)`${r}.length`), _ = t.let("j");
      e.setParams({ i: b, j: _ }), t.assign(i, !0), t.if((0, he._)`${b} > 1`, () => (p() ? w : y)(b, _));
    }
    function p() {
      return f.length > 0 && !f.some((b) => b === "object" || b === "array");
    }
    function w(b, _) {
      const d = t.name("item"), m = (0, jn.checkDataTypes)(f, d, u.opts.strictNumbers, jn.DataType.Wrong), $ = t.const("indices", (0, he._)`{}`);
      t.for((0, he._)`;${b}--;`, () => {
        t.let(d, (0, he._)`${r}[${b}]`), t.if(m, (0, he._)`continue`), f.length > 1 && t.if((0, he._)`typeof ${d} == "string"`, (0, he._)`${d} += "_"`), t.if((0, he._)`typeof ${$}[${d}] == "number"`, () => {
          t.assign(_, (0, he._)`${$}[${d}]`), e.error(), t.assign(i, !1).break();
        }).code((0, he._)`${$}[${d}] = ${b}`);
      });
    }
    function y(b, _) {
      const d = (0, Id.useFunc)(t, Nd.default), m = t.name("outer");
      t.label(m).for((0, he._)`;${b}--;`, () => t.for((0, he._)`${_} = ${b}; ${_}--;`, () => t.if((0, he._)`${d}(${r}[${b}], ${r}[${_}])`, () => {
        e.error(), t.assign(i, !1).break(m);
      })));
    }
  }
};
Ds.default = jd;
var Ls = {};
Object.defineProperty(Ls, "__esModule", { value: !0 });
const Yn = q, Ad = C, kd = sr, Cd = {
  message: "must be equal to constant",
  params: ({ schemaCode: e }) => (0, Yn._)`{allowedValue: ${e}}`
}, Dd = {
  keyword: "const",
  $data: !0,
  error: Cd,
  code(e) {
    const { gen: t, data: r, $data: n, schemaCode: s, schema: a } = e;
    n || a && typeof a == "object" ? e.fail$data((0, Yn._)`!${(0, Ad.useFunc)(t, kd.default)}(${r}, ${s})`) : e.fail((0, Yn._)`${a} !== ${r}`);
  }
};
Ls.default = Dd;
var Ms = {};
Object.defineProperty(Ms, "__esModule", { value: !0 });
const Xt = q, Ld = C, Md = sr, Fd = {
  message: "must be equal to one of the allowed values",
  params: ({ schemaCode: e }) => (0, Xt._)`{allowedValues: ${e}}`
}, Vd = {
  keyword: "enum",
  schemaType: "array",
  $data: !0,
  error: Fd,
  code(e) {
    const { gen: t, data: r, $data: n, schema: s, schemaCode: a, it: o } = e;
    if (!n && s.length === 0)
      throw new Error("enum must have non-empty array");
    const u = s.length >= o.opts.loopEnum;
    let i;
    const f = () => i ?? (i = (0, Ld.useFunc)(t, Md.default));
    let c;
    if (u || n)
      c = t.let("valid"), e.block$data(c, p);
    else {
      if (!Array.isArray(s))
        throw new Error("ajv implementation error");
      const y = t.const("vSchema", a);
      c = (0, Xt.or)(...s.map((b, _) => w(y, _)));
    }
    e.pass(c);
    function p() {
      t.assign(c, !1), t.forOf("v", a, (y) => t.if((0, Xt._)`${f()}(${r}, ${y})`, () => t.assign(c, !0).break()));
    }
    function w(y, b) {
      const _ = s[b];
      return typeof _ == "object" && _ !== null ? (0, Xt._)`${f()}(${r}, ${y}[${b}])` : (0, Xt._)`${r} === ${_}`;
    }
  }
};
Ms.default = Vd;
Object.defineProperty(Zr, "__esModule", { value: !0 });
const zd = Os, Ud = Is, Gd = Ns, qd = js, Kd = As, Hd = ks, Wd = Cs, xd = Ds, Bd = Ls, Xd = Ms, Yd = [
  // number
  zd.default,
  Ud.default,
  // string
  Gd.default,
  qd.default,
  // object
  Kd.default,
  Hd.default,
  // array
  Wd.default,
  xd.default,
  // any
  { keyword: "type", schemaType: ["string", "array"] },
  { keyword: "nullable", schemaType: "boolean" },
  Bd.default,
  Xd.default
];
Zr.default = Yd;
var Qr = {}, Vt = {};
Object.defineProperty(Vt, "__esModule", { value: !0 });
Vt.validateAdditionalItems = void 0;
const dt = q, Jn = C, Jd = {
  message: ({ params: { len: e } }) => (0, dt.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, dt._)`{limit: ${e}}`
}, Zd = {
  keyword: "additionalItems",
  type: "array",
  schemaType: ["boolean", "object"],
  before: "uniqueItems",
  error: Jd,
  code(e) {
    const { parentSchema: t, it: r } = e, { items: n } = t;
    if (!Array.isArray(n)) {
      (0, Jn.checkStrictMode)(r, '"additionalItems" is ignored when "items" is not an array of schemas');
      return;
    }
    Hi(e, n);
  }
};
function Hi(e, t) {
  const { gen: r, schema: n, data: s, keyword: a, it: o } = e;
  o.items = !0;
  const u = r.const("len", (0, dt._)`${s}.length`);
  if (n === !1)
    e.setParams({ len: t.length }), e.pass((0, dt._)`${u} <= ${t.length}`);
  else if (typeof n == "object" && !(0, Jn.alwaysValidSchema)(o, n)) {
    const f = r.var("valid", (0, dt._)`${u} <= ${t.length}`);
    r.if((0, dt.not)(f), () => i(f)), e.ok(f);
  }
  function i(f) {
    r.forRange("i", t.length, u, (c) => {
      e.subschema({ keyword: a, dataProp: c, dataPropType: Jn.Type.Num }, f), o.allErrors || r.if((0, dt.not)(f), () => r.break());
    });
  }
}
Vt.validateAdditionalItems = Hi;
Vt.default = Zd;
var Fs = {}, zt = {};
Object.defineProperty(zt, "__esModule", { value: !0 });
zt.validateTuple = void 0;
const Wa = q, Nr = C, Qd = Y, eh = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "array", "boolean"],
  before: "uniqueItems",
  code(e) {
    const { schema: t, it: r } = e;
    if (Array.isArray(t))
      return Wi(e, "additionalItems", t);
    r.items = !0, !(0, Nr.alwaysValidSchema)(r, t) && e.ok((0, Qd.validateArray)(e));
  }
};
function Wi(e, t, r = e.schema) {
  const { gen: n, parentSchema: s, data: a, keyword: o, it: u } = e;
  c(s), u.opts.unevaluated && r.length && u.items !== !0 && (u.items = Nr.mergeEvaluated.items(n, r.length, u.items));
  const i = n.name("valid"), f = n.const("len", (0, Wa._)`${a}.length`);
  r.forEach((p, w) => {
    (0, Nr.alwaysValidSchema)(u, p) || (n.if((0, Wa._)`${f} > ${w}`, () => e.subschema({
      keyword: o,
      schemaProp: w,
      dataProp: w
    }, i)), e.ok(i));
  });
  function c(p) {
    const { opts: w, errSchemaPath: y } = u, b = r.length, _ = b === p.minItems && (b === p.maxItems || p[t] === !1);
    if (w.strictTuples && !_) {
      const d = `"${o}" is ${b}-tuple, but minItems or maxItems/${t} are not specified or different at path "${y}"`;
      (0, Nr.checkStrictMode)(u, d, w.strictTuples);
    }
  }
}
zt.validateTuple = Wi;
zt.default = eh;
Object.defineProperty(Fs, "__esModule", { value: !0 });
const th = zt, rh = {
  keyword: "prefixItems",
  type: "array",
  schemaType: ["array"],
  before: "uniqueItems",
  code: (e) => (0, th.validateTuple)(e, "items")
};
Fs.default = rh;
var Vs = {};
Object.defineProperty(Vs, "__esModule", { value: !0 });
const xa = q, nh = C, sh = Y, ah = Vt, oh = {
  message: ({ params: { len: e } }) => (0, xa.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, xa._)`{limit: ${e}}`
}, ih = {
  keyword: "items",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  error: oh,
  code(e) {
    const { schema: t, parentSchema: r, it: n } = e, { prefixItems: s } = r;
    n.items = !0, !(0, nh.alwaysValidSchema)(n, t) && (s ? (0, ah.validateAdditionalItems)(e, s) : e.ok((0, sh.validateArray)(e)));
  }
};
Vs.default = ih;
var zs = {};
Object.defineProperty(zs, "__esModule", { value: !0 });
const je = q, hr = C, ch = {
  message: ({ params: { min: e, max: t } }) => t === void 0 ? (0, je.str)`must contain at least ${e} valid item(s)` : (0, je.str)`must contain at least ${e} and no more than ${t} valid item(s)`,
  params: ({ params: { min: e, max: t } }) => t === void 0 ? (0, je._)`{minContains: ${e}}` : (0, je._)`{minContains: ${e}, maxContains: ${t}}`
}, uh = {
  keyword: "contains",
  type: "array",
  schemaType: ["object", "boolean"],
  before: "uniqueItems",
  trackErrors: !0,
  error: ch,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: a } = e;
    let o, u;
    const { minContains: i, maxContains: f } = n;
    a.opts.next ? (o = i === void 0 ? 1 : i, u = f) : o = 1;
    const c = t.const("len", (0, je._)`${s}.length`);
    if (e.setParams({ min: o, max: u }), u === void 0 && o === 0) {
      (0, hr.checkStrictMode)(a, '"minContains" == 0 without "maxContains": "contains" keyword ignored');
      return;
    }
    if (u !== void 0 && o > u) {
      (0, hr.checkStrictMode)(a, '"minContains" > "maxContains" is always invalid'), e.fail();
      return;
    }
    if ((0, hr.alwaysValidSchema)(a, r)) {
      let _ = (0, je._)`${c} >= ${o}`;
      u !== void 0 && (_ = (0, je._)`${_} && ${c} <= ${u}`), e.pass(_);
      return;
    }
    a.items = !0;
    const p = t.name("valid");
    u === void 0 && o === 1 ? y(p, () => t.if(p, () => t.break())) : o === 0 ? (t.let(p, !0), u !== void 0 && t.if((0, je._)`${s}.length > 0`, w)) : (t.let(p, !1), w()), e.result(p, () => e.reset());
    function w() {
      const _ = t.name("_valid"), d = t.let("count", 0);
      y(_, () => t.if(_, () => b(d)));
    }
    function y(_, d) {
      t.forRange("i", 0, c, (m) => {
        e.subschema({
          keyword: "contains",
          dataProp: m,
          dataPropType: hr.Type.Num,
          compositeRule: !0
        }, _), d();
      });
    }
    function b(_) {
      t.code((0, je._)`${_}++`), u === void 0 ? t.if((0, je._)`${_} >= ${o}`, () => t.assign(p, !0).break()) : (t.if((0, je._)`${_} > ${u}`, () => t.assign(p, !1).break()), o === 1 ? t.assign(p, !0) : t.if((0, je._)`${_} >= ${o}`, () => t.assign(p, !0)));
    }
  }
};
zs.default = uh;
var en = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.validateSchemaDeps = e.validatePropertyDeps = e.error = void 0;
  const t = q, r = C, n = Y;
  e.error = {
    message: ({ params: { property: i, depsCount: f, deps: c } }) => {
      const p = f === 1 ? "property" : "properties";
      return (0, t.str)`must have ${p} ${c} when property ${i} is present`;
    },
    params: ({ params: { property: i, depsCount: f, deps: c, missingProperty: p } }) => (0, t._)`{property: ${i},
    missingProperty: ${p},
    depsCount: ${f},
    deps: ${c}}`
    // TODO change to reference
  };
  const s = {
    keyword: "dependencies",
    type: "object",
    schemaType: "object",
    error: e.error,
    code(i) {
      const [f, c] = a(i);
      o(i, f), u(i, c);
    }
  };
  function a({ schema: i }) {
    const f = {}, c = {};
    for (const p in i) {
      if (p === "__proto__")
        continue;
      const w = Array.isArray(i[p]) ? f : c;
      w[p] = i[p];
    }
    return [f, c];
  }
  function o(i, f = i.schema) {
    const { gen: c, data: p, it: w } = i;
    if (Object.keys(f).length === 0)
      return;
    const y = c.let("missing");
    for (const b in f) {
      const _ = f[b];
      if (_.length === 0)
        continue;
      const d = (0, n.propertyInData)(c, p, b, w.opts.ownProperties);
      i.setParams({
        property: b,
        depsCount: _.length,
        deps: _.join(", ")
      }), w.allErrors ? c.if(d, () => {
        for (const m of _)
          (0, n.checkReportMissingProp)(i, m);
      }) : (c.if((0, t._)`${d} && (${(0, n.checkMissingProp)(i, _, y)})`), (0, n.reportMissingProp)(i, y), c.else());
    }
  }
  e.validatePropertyDeps = o;
  function u(i, f = i.schema) {
    const { gen: c, data: p, keyword: w, it: y } = i, b = c.name("valid");
    for (const _ in f)
      (0, r.alwaysValidSchema)(y, f[_]) || (c.if(
        (0, n.propertyInData)(c, p, _, y.opts.ownProperties),
        () => {
          const d = i.subschema({ keyword: w, schemaProp: _ }, b);
          i.mergeValidEvaluated(d, b);
        },
        () => c.var(b, !0)
        // TODO var
      ), i.ok(b));
  }
  e.validateSchemaDeps = u, e.default = s;
})(en);
var Us = {};
Object.defineProperty(Us, "__esModule", { value: !0 });
const xi = q, lh = C, fh = {
  message: "property name must be valid",
  params: ({ params: e }) => (0, xi._)`{propertyName: ${e.propertyName}}`
}, dh = {
  keyword: "propertyNames",
  type: "object",
  schemaType: ["object", "boolean"],
  error: fh,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e;
    if ((0, lh.alwaysValidSchema)(s, r))
      return;
    const a = t.name("valid");
    t.forIn("key", n, (o) => {
      e.setParams({ propertyName: o }), e.subschema({
        keyword: "propertyNames",
        data: o,
        dataTypes: ["string"],
        propertyName: o,
        compositeRule: !0
      }, a), t.if((0, xi.not)(a), () => {
        e.error(!0), s.allErrors || t.break();
      });
    }), e.ok(a);
  }
};
Us.default = dh;
var tn = {};
Object.defineProperty(tn, "__esModule", { value: !0 });
const mr = Y, Ce = q, hh = Ne, pr = C, mh = {
  message: "must NOT have additional properties",
  params: ({ params: e }) => (0, Ce._)`{additionalProperty: ${e.additionalProperty}}`
}, ph = {
  keyword: "additionalProperties",
  type: ["object"],
  schemaType: ["boolean", "object"],
  allowUndefined: !0,
  trackErrors: !0,
  error: mh,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, errsCount: a, it: o } = e;
    if (!a)
      throw new Error("ajv implementation error");
    const { allErrors: u, opts: i } = o;
    if (o.props = !0, i.removeAdditional !== "all" && (0, pr.alwaysValidSchema)(o, r))
      return;
    const f = (0, mr.allSchemaProperties)(n.properties), c = (0, mr.allSchemaProperties)(n.patternProperties);
    p(), e.ok((0, Ce._)`${a} === ${hh.default.errors}`);
    function p() {
      t.forIn("key", s, (d) => {
        !f.length && !c.length ? b(d) : t.if(w(d), () => b(d));
      });
    }
    function w(d) {
      let m;
      if (f.length > 8) {
        const $ = (0, pr.schemaRefOrVal)(o, n.properties, "properties");
        m = (0, mr.isOwnProperty)(t, $, d);
      } else
        f.length ? m = (0, Ce.or)(...f.map(($) => (0, Ce._)`${d} === ${$}`)) : m = Ce.nil;
      return c.length && (m = (0, Ce.or)(m, ...c.map(($) => (0, Ce._)`${(0, mr.usePattern)(e, $)}.test(${d})`))), (0, Ce.not)(m);
    }
    function y(d) {
      t.code((0, Ce._)`delete ${s}[${d}]`);
    }
    function b(d) {
      if (i.removeAdditional === "all" || i.removeAdditional && r === !1) {
        y(d);
        return;
      }
      if (r === !1) {
        e.setParams({ additionalProperty: d }), e.error(), u || t.break();
        return;
      }
      if (typeof r == "object" && !(0, pr.alwaysValidSchema)(o, r)) {
        const m = t.name("valid");
        i.removeAdditional === "failing" ? (_(d, m, !1), t.if((0, Ce.not)(m), () => {
          e.reset(), y(d);
        })) : (_(d, m), u || t.if((0, Ce.not)(m), () => t.break()));
      }
    }
    function _(d, m, $) {
      const P = {
        keyword: "additionalProperties",
        dataProp: d,
        dataPropType: pr.Type.Str
      };
      $ === !1 && Object.assign(P, {
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }), e.subschema(P, m);
    }
  }
};
tn.default = ph;
var Gs = {};
Object.defineProperty(Gs, "__esModule", { value: !0 });
const yh = Ae, Ba = Y, An = C, Xa = tn, $h = {
  keyword: "properties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, parentSchema: n, data: s, it: a } = e;
    a.opts.removeAdditional === "all" && n.additionalProperties === void 0 && Xa.default.code(new yh.KeywordCxt(a, Xa.default, "additionalProperties"));
    const o = (0, Ba.allSchemaProperties)(r);
    for (const p of o)
      a.definedProperties.add(p);
    a.opts.unevaluated && o.length && a.props !== !0 && (a.props = An.mergeEvaluated.props(t, (0, An.toHash)(o), a.props));
    const u = o.filter((p) => !(0, An.alwaysValidSchema)(a, r[p]));
    if (u.length === 0)
      return;
    const i = t.name("valid");
    for (const p of u)
      f(p) ? c(p) : (t.if((0, Ba.propertyInData)(t, s, p, a.opts.ownProperties)), c(p), a.allErrors || t.else().var(i, !0), t.endIf()), e.it.definedProperties.add(p), e.ok(i);
    function f(p) {
      return a.opts.useDefaults && !a.compositeRule && r[p].default !== void 0;
    }
    function c(p) {
      e.subschema({
        keyword: "properties",
        schemaProp: p,
        dataProp: p
      }, i);
    }
  }
};
Gs.default = $h;
var qs = {};
Object.defineProperty(qs, "__esModule", { value: !0 });
const Ya = Y, yr = q, Ja = C, Za = C, gh = {
  keyword: "patternProperties",
  type: "object",
  schemaType: "object",
  code(e) {
    const { gen: t, schema: r, data: n, parentSchema: s, it: a } = e, { opts: o } = a, u = (0, Ya.allSchemaProperties)(r), i = u.filter((_) => (0, Ja.alwaysValidSchema)(a, r[_]));
    if (u.length === 0 || i.length === u.length && (!a.opts.unevaluated || a.props === !0))
      return;
    const f = o.strictSchema && !o.allowMatchingProperties && s.properties, c = t.name("valid");
    a.props !== !0 && !(a.props instanceof yr.Name) && (a.props = (0, Za.evaluatedPropsToName)(t, a.props));
    const { props: p } = a;
    w();
    function w() {
      for (const _ of u)
        f && y(_), a.allErrors ? b(_) : (t.var(c, !0), b(_), t.if(c));
    }
    function y(_) {
      for (const d in f)
        new RegExp(_).test(d) && (0, Ja.checkStrictMode)(a, `property ${d} matches pattern ${_} (use allowMatchingProperties)`);
    }
    function b(_) {
      t.forIn("key", n, (d) => {
        t.if((0, yr._)`${(0, Ya.usePattern)(e, _)}.test(${d})`, () => {
          const m = i.includes(_);
          m || e.subschema({
            keyword: "patternProperties",
            schemaProp: _,
            dataProp: d,
            dataPropType: Za.Type.Str
          }, c), a.opts.unevaluated && p !== !0 ? t.assign((0, yr._)`${p}[${d}]`, !0) : !m && !a.allErrors && t.if((0, yr.not)(c), () => t.break());
        });
      });
    }
  }
};
qs.default = gh;
var Ks = {};
Object.defineProperty(Ks, "__esModule", { value: !0 });
const vh = C, _h = {
  keyword: "not",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if ((0, vh.alwaysValidSchema)(n, r)) {
      e.fail();
      return;
    }
    const s = t.name("valid");
    e.subschema({
      keyword: "not",
      compositeRule: !0,
      createErrors: !1,
      allErrors: !1
    }, s), e.failResult(s, () => e.reset(), () => e.error());
  },
  error: { message: "must NOT be valid" }
};
Ks.default = _h;
var Hs = {};
Object.defineProperty(Hs, "__esModule", { value: !0 });
const Eh = Y, wh = {
  keyword: "anyOf",
  schemaType: "array",
  trackErrors: !0,
  code: Eh.validateUnion,
  error: { message: "must match a schema in anyOf" }
};
Hs.default = wh;
var Ws = {};
Object.defineProperty(Ws, "__esModule", { value: !0 });
const Tr = q, Sh = C, bh = {
  message: "must match exactly one schema in oneOf",
  params: ({ params: e }) => (0, Tr._)`{passingSchemas: ${e.passing}}`
}, Ph = {
  keyword: "oneOf",
  schemaType: "array",
  trackErrors: !0,
  error: bh,
  code(e) {
    const { gen: t, schema: r, parentSchema: n, it: s } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    if (s.opts.discriminator && n.discriminator)
      return;
    const a = r, o = t.let("valid", !1), u = t.let("passing", null), i = t.name("_valid");
    e.setParams({ passing: u }), t.block(f), e.result(o, () => e.reset(), () => e.error(!0));
    function f() {
      a.forEach((c, p) => {
        let w;
        (0, Sh.alwaysValidSchema)(s, c) ? t.var(i, !0) : w = e.subschema({
          keyword: "oneOf",
          schemaProp: p,
          compositeRule: !0
        }, i), p > 0 && t.if((0, Tr._)`${i} && ${o}`).assign(o, !1).assign(u, (0, Tr._)`[${u}, ${p}]`).else(), t.if(i, () => {
          t.assign(o, !0), t.assign(u, p), w && e.mergeEvaluated(w, Tr.Name);
        });
      });
    }
  }
};
Ws.default = Ph;
var xs = {};
Object.defineProperty(xs, "__esModule", { value: !0 });
const Rh = C, Oh = {
  keyword: "allOf",
  schemaType: "array",
  code(e) {
    const { gen: t, schema: r, it: n } = e;
    if (!Array.isArray(r))
      throw new Error("ajv implementation error");
    const s = t.name("valid");
    r.forEach((a, o) => {
      if ((0, Rh.alwaysValidSchema)(n, a))
        return;
      const u = e.subschema({ keyword: "allOf", schemaProp: o }, s);
      e.ok(s), e.mergeEvaluated(u);
    });
  }
};
xs.default = Oh;
var Bs = {};
Object.defineProperty(Bs, "__esModule", { value: !0 });
const Lr = q, Bi = C, Ih = {
  message: ({ params: e }) => (0, Lr.str)`must match "${e.ifClause}" schema`,
  params: ({ params: e }) => (0, Lr._)`{failingKeyword: ${e.ifClause}}`
}, Nh = {
  keyword: "if",
  schemaType: ["object", "boolean"],
  trackErrors: !0,
  error: Ih,
  code(e) {
    const { gen: t, parentSchema: r, it: n } = e;
    r.then === void 0 && r.else === void 0 && (0, Bi.checkStrictMode)(n, '"if" without "then" and "else" is ignored');
    const s = Qa(n, "then"), a = Qa(n, "else");
    if (!s && !a)
      return;
    const o = t.let("valid", !0), u = t.name("_valid");
    if (i(), e.reset(), s && a) {
      const c = t.let("ifClause");
      e.setParams({ ifClause: c }), t.if(u, f("then", c), f("else", c));
    } else
      s ? t.if(u, f("then")) : t.if((0, Lr.not)(u), f("else"));
    e.pass(o, () => e.error(!0));
    function i() {
      const c = e.subschema({
        keyword: "if",
        compositeRule: !0,
        createErrors: !1,
        allErrors: !1
      }, u);
      e.mergeEvaluated(c);
    }
    function f(c, p) {
      return () => {
        const w = e.subschema({ keyword: c }, u);
        t.assign(o, u), e.mergeValidEvaluated(w, o), p ? t.assign(p, (0, Lr._)`${c}`) : e.setParams({ ifClause: c });
      };
    }
  }
};
function Qa(e, t) {
  const r = e.schema[t];
  return r !== void 0 && !(0, Bi.alwaysValidSchema)(e, r);
}
Bs.default = Nh;
var Xs = {};
Object.defineProperty(Xs, "__esModule", { value: !0 });
const Th = C, jh = {
  keyword: ["then", "else"],
  schemaType: ["object", "boolean"],
  code({ keyword: e, parentSchema: t, it: r }) {
    t.if === void 0 && (0, Th.checkStrictMode)(r, `"${e}" without "if" is ignored`);
  }
};
Xs.default = jh;
Object.defineProperty(Qr, "__esModule", { value: !0 });
const Ah = Vt, kh = Fs, Ch = zt, Dh = Vs, Lh = zs, Mh = en, Fh = Us, Vh = tn, zh = Gs, Uh = qs, Gh = Ks, qh = Hs, Kh = Ws, Hh = xs, Wh = Bs, xh = Xs;
function Bh(e = !1) {
  const t = [
    // any
    Gh.default,
    qh.default,
    Kh.default,
    Hh.default,
    Wh.default,
    xh.default,
    // object
    Fh.default,
    Vh.default,
    Mh.default,
    zh.default,
    Uh.default
  ];
  return e ? t.push(kh.default, Dh.default) : t.push(Ah.default, Ch.default), t.push(Lh.default), t;
}
Qr.default = Bh;
var Ys = {}, Ut = {};
Object.defineProperty(Ut, "__esModule", { value: !0 });
Ut.dynamicAnchor = void 0;
const kn = q, Xh = Ne, eo = we, Yh = Be, Jh = {
  keyword: "$dynamicAnchor",
  schemaType: "string",
  code: (e) => Xi(e, e.schema)
};
function Xi(e, t) {
  const { gen: r, it: n } = e;
  n.schemaEnv.root.dynamicAnchors[t] = !0;
  const s = (0, kn._)`${Xh.default.dynamicAnchors}${(0, kn.getProperty)(t)}`, a = n.errSchemaPath === "#" ? n.validateName : Zh(e);
  r.if((0, kn._)`!${s}`, () => r.assign(s, a));
}
Ut.dynamicAnchor = Xi;
function Zh(e) {
  const { schemaEnv: t, schema: r, self: n } = e.it, { root: s, baseId: a, localRefs: o, meta: u } = t.root, { schemaId: i } = n.opts, f = new eo.SchemaEnv({ schema: r, schemaId: i, root: s, baseId: a, localRefs: o, meta: u });
  return eo.compileSchema.call(n, f), (0, Yh.getValidate)(e, f);
}
Ut.default = Jh;
var Gt = {};
Object.defineProperty(Gt, "__esModule", { value: !0 });
Gt.dynamicRef = void 0;
const to = q, Qh = Ne, ro = Be, em = {
  keyword: "$dynamicRef",
  schemaType: "string",
  code: (e) => Yi(e, e.schema)
};
function Yi(e, t) {
  const { gen: r, keyword: n, it: s } = e;
  if (t[0] !== "#")
    throw new Error(`"${n}" only supports hash fragment reference`);
  const a = t.slice(1);
  if (s.allErrors)
    o();
  else {
    const i = r.let("valid", !1);
    o(i), e.ok(i);
  }
  function o(i) {
    if (s.schemaEnv.root.dynamicAnchors[a]) {
      const f = r.let("_v", (0, to._)`${Qh.default.dynamicAnchors}${(0, to.getProperty)(a)}`);
      r.if(f, u(f, i), u(s.validateName, i));
    } else
      u(s.validateName, i)();
  }
  function u(i, f) {
    return f ? () => r.block(() => {
      (0, ro.callRef)(e, i), r.let(f, !0);
    }) : () => (0, ro.callRef)(e, i);
  }
}
Gt.dynamicRef = Yi;
Gt.default = em;
var Js = {};
Object.defineProperty(Js, "__esModule", { value: !0 });
const tm = Ut, rm = C, nm = {
  keyword: "$recursiveAnchor",
  schemaType: "boolean",
  code(e) {
    e.schema ? (0, tm.dynamicAnchor)(e, "") : (0, rm.checkStrictMode)(e.it, "$recursiveAnchor: false is ignored");
  }
};
Js.default = nm;
var Zs = {};
Object.defineProperty(Zs, "__esModule", { value: !0 });
const sm = Gt, am = {
  keyword: "$recursiveRef",
  schemaType: "string",
  code: (e) => (0, sm.dynamicRef)(e, e.schema)
};
Zs.default = am;
Object.defineProperty(Ys, "__esModule", { value: !0 });
const om = Ut, im = Gt, cm = Js, um = Zs, lm = [om.default, im.default, cm.default, um.default];
Ys.default = lm;
var Qs = {}, ea = {};
Object.defineProperty(ea, "__esModule", { value: !0 });
const no = en, fm = {
  keyword: "dependentRequired",
  type: "object",
  schemaType: "object",
  error: no.error,
  code: (e) => (0, no.validatePropertyDeps)(e)
};
ea.default = fm;
var ta = {};
Object.defineProperty(ta, "__esModule", { value: !0 });
const dm = en, hm = {
  keyword: "dependentSchemas",
  type: "object",
  schemaType: "object",
  code: (e) => (0, dm.validateSchemaDeps)(e)
};
ta.default = hm;
var ra = {};
Object.defineProperty(ra, "__esModule", { value: !0 });
const mm = C, pm = {
  keyword: ["maxContains", "minContains"],
  type: "array",
  schemaType: "number",
  code({ keyword: e, parentSchema: t, it: r }) {
    t.contains === void 0 && (0, mm.checkStrictMode)(r, `"${e}" without "contains" is ignored`);
  }
};
ra.default = pm;
Object.defineProperty(Qs, "__esModule", { value: !0 });
const ym = ea, $m = ta, gm = ra, vm = [ym.default, $m.default, gm.default];
Qs.default = vm;
var na = {}, sa = {};
Object.defineProperty(sa, "__esModule", { value: !0 });
const tt = q, so = C, _m = Ne, Em = {
  message: "must NOT have unevaluated properties",
  params: ({ params: e }) => (0, tt._)`{unevaluatedProperty: ${e.unevaluatedProperty}}`
}, wm = {
  keyword: "unevaluatedProperties",
  type: "object",
  schemaType: ["boolean", "object"],
  trackErrors: !0,
  error: Em,
  code(e) {
    const { gen: t, schema: r, data: n, errsCount: s, it: a } = e;
    if (!s)
      throw new Error("ajv implementation error");
    const { allErrors: o, props: u } = a;
    u instanceof tt.Name ? t.if((0, tt._)`${u} !== true`, () => t.forIn("key", n, (p) => t.if(f(u, p), () => i(p)))) : u !== !0 && t.forIn("key", n, (p) => u === void 0 ? i(p) : t.if(c(u, p), () => i(p))), a.props = !0, e.ok((0, tt._)`${s} === ${_m.default.errors}`);
    function i(p) {
      if (r === !1) {
        e.setParams({ unevaluatedProperty: p }), e.error(), o || t.break();
        return;
      }
      if (!(0, so.alwaysValidSchema)(a, r)) {
        const w = t.name("valid");
        e.subschema({
          keyword: "unevaluatedProperties",
          dataProp: p,
          dataPropType: so.Type.Str
        }, w), o || t.if((0, tt.not)(w), () => t.break());
      }
    }
    function f(p, w) {
      return (0, tt._)`!${p} || !${p}[${w}]`;
    }
    function c(p, w) {
      const y = [];
      for (const b in p)
        p[b] === !0 && y.push((0, tt._)`${w} !== ${b}`);
      return (0, tt.and)(...y);
    }
  }
};
sa.default = wm;
var aa = {};
Object.defineProperty(aa, "__esModule", { value: !0 });
const ht = q, ao = C, Sm = {
  message: ({ params: { len: e } }) => (0, ht.str)`must NOT have more than ${e} items`,
  params: ({ params: { len: e } }) => (0, ht._)`{limit: ${e}}`
}, bm = {
  keyword: "unevaluatedItems",
  type: "array",
  schemaType: ["boolean", "object"],
  error: Sm,
  code(e) {
    const { gen: t, schema: r, data: n, it: s } = e, a = s.items || 0;
    if (a === !0)
      return;
    const o = t.const("len", (0, ht._)`${n}.length`);
    if (r === !1)
      e.setParams({ len: a }), e.fail((0, ht._)`${o} > ${a}`);
    else if (typeof r == "object" && !(0, ao.alwaysValidSchema)(s, r)) {
      const i = t.var("valid", (0, ht._)`${o} <= ${a}`);
      t.if((0, ht.not)(i), () => u(i, a)), e.ok(i);
    }
    s.items = !0;
    function u(i, f) {
      t.forRange("i", f, o, (c) => {
        e.subschema({ keyword: "unevaluatedItems", dataProp: c, dataPropType: ao.Type.Num }, i), s.allErrors || t.if((0, ht.not)(i), () => t.break());
      });
    }
  }
};
aa.default = bm;
Object.defineProperty(na, "__esModule", { value: !0 });
const Pm = sa, Rm = aa, Om = [Pm.default, Rm.default];
na.default = Om;
var rn = {}, oa = {};
Object.defineProperty(oa, "__esModule", { value: !0 });
const ce = q, Im = {
  message: ({ schemaCode: e }) => (0, ce.str)`must match format "${e}"`,
  params: ({ schemaCode: e }) => (0, ce._)`{format: ${e}}`
}, Nm = {
  keyword: "format",
  type: ["number", "string"],
  schemaType: "string",
  $data: !0,
  error: Im,
  code(e, t) {
    const { gen: r, data: n, $data: s, schema: a, schemaCode: o, it: u } = e, { opts: i, errSchemaPath: f, schemaEnv: c, self: p } = u;
    if (!i.validateFormats)
      return;
    s ? w() : y();
    function w() {
      const b = r.scopeValue("formats", {
        ref: p.formats,
        code: i.code.formats
      }), _ = r.const("fDef", (0, ce._)`${b}[${o}]`), d = r.let("fType"), m = r.let("format");
      r.if((0, ce._)`typeof ${_} == "object" && !(${_} instanceof RegExp)`, () => r.assign(d, (0, ce._)`${_}.type || "string"`).assign(m, (0, ce._)`${_}.validate`), () => r.assign(d, (0, ce._)`"string"`).assign(m, _)), e.fail$data((0, ce.or)($(), P()));
      function $() {
        return i.strictSchema === !1 ? ce.nil : (0, ce._)`${o} && !${m}`;
      }
      function P() {
        const R = c.$async ? (0, ce._)`(${_}.async ? await ${m}(${n}) : ${m}(${n}))` : (0, ce._)`${m}(${n})`, I = (0, ce._)`(typeof ${m} == "function" ? ${R} : ${m}.test(${n}))`;
        return (0, ce._)`${m} && ${m} !== true && ${d} === ${t} && !${I}`;
      }
    }
    function y() {
      const b = p.formats[a];
      if (!b) {
        $();
        return;
      }
      if (b === !0)
        return;
      const [_, d, m] = P(b);
      _ === t && e.pass(R());
      function $() {
        if (i.strictSchema === !1) {
          p.logger.warn(I());
          return;
        }
        throw new Error(I());
        function I() {
          return `unknown format "${a}" ignored in schema at path "${f}"`;
        }
      }
      function P(I) {
        const T = I instanceof RegExp ? (0, ce.regexpCode)(I) : i.code.formats ? (0, ce._)`${i.code.formats}${(0, ce.getProperty)(a)}` : void 0, V = r.scopeValue("formats", { key: a, ref: I, code: T });
        return typeof I == "object" && !(I instanceof RegExp) ? [I.type || "string", I.validate, (0, ce._)`${V}.validate`] : ["string", I, V];
      }
      function R() {
        if (typeof b == "object" && !(b instanceof RegExp) && b.async) {
          if (!c.$async)
            throw new Error("async format in sync schema");
          return (0, ce._)`await ${m}(${n})`;
        }
        return typeof d == "function" ? (0, ce._)`${m}(${n})` : (0, ce._)`${m}.test(${n})`;
      }
    }
  }
};
oa.default = Nm;
Object.defineProperty(rn, "__esModule", { value: !0 });
const Tm = oa, jm = [Tm.default];
rn.default = jm;
var _t = {};
Object.defineProperty(_t, "__esModule", { value: !0 });
_t.contentVocabulary = _t.metadataVocabulary = void 0;
_t.metadataVocabulary = [
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "examples"
];
_t.contentVocabulary = [
  "contentMediaType",
  "contentEncoding",
  "contentSchema"
];
Object.defineProperty(Ps, "__esModule", { value: !0 });
const Am = Jr, km = Zr, Cm = Qr, Dm = Ys, Lm = Qs, Mm = na, Fm = rn, oo = _t, Vm = [
  Dm.default,
  Am.default,
  km.default,
  (0, Cm.default)(!0),
  Fm.default,
  oo.metadataVocabulary,
  oo.contentVocabulary,
  Lm.default,
  Mm.default
];
Ps.default = Vm;
var nn = {}, sn = {};
Object.defineProperty(sn, "__esModule", { value: !0 });
sn.DiscrError = void 0;
var io;
(function(e) {
  e.Tag = "tag", e.Mapping = "mapping";
})(io || (sn.DiscrError = io = {}));
Object.defineProperty(nn, "__esModule", { value: !0 });
const Rt = q, Zn = sn, co = we, zm = Et, Um = C, Gm = {
  message: ({ params: { discrError: e, tagName: t } }) => e === Zn.DiscrError.Tag ? `tag "${t}" must be string` : `value of tag "${t}" must be in oneOf`,
  params: ({ params: { discrError: e, tag: t, tagName: r } }) => (0, Rt._)`{error: ${e}, tag: ${r}, tagValue: ${t}}`
}, qm = {
  keyword: "discriminator",
  type: "object",
  schemaType: "object",
  error: Gm,
  code(e) {
    const { gen: t, data: r, schema: n, parentSchema: s, it: a } = e, { oneOf: o } = s;
    if (!a.opts.discriminator)
      throw new Error("discriminator: requires discriminator option");
    const u = n.propertyName;
    if (typeof u != "string")
      throw new Error("discriminator: requires propertyName");
    if (n.mapping)
      throw new Error("discriminator: mapping is not supported");
    if (!o)
      throw new Error("discriminator: requires oneOf keyword");
    const i = t.let("valid", !1), f = t.const("tag", (0, Rt._)`${r}${(0, Rt.getProperty)(u)}`);
    t.if((0, Rt._)`typeof ${f} == "string"`, () => c(), () => e.error(!1, { discrError: Zn.DiscrError.Tag, tag: f, tagName: u })), e.ok(i);
    function c() {
      const y = w();
      t.if(!1);
      for (const b in y)
        t.elseIf((0, Rt._)`${f} === ${b}`), t.assign(i, p(y[b]));
      t.else(), e.error(!1, { discrError: Zn.DiscrError.Mapping, tag: f, tagName: u }), t.endIf();
    }
    function p(y) {
      const b = t.name("valid"), _ = e.subschema({ keyword: "oneOf", schemaProp: y }, b);
      return e.mergeEvaluated(_, Rt.Name), b;
    }
    function w() {
      var y;
      const b = {}, _ = m(s);
      let d = !0;
      for (let R = 0; R < o.length; R++) {
        let I = o[R];
        if (I != null && I.$ref && !(0, Um.schemaHasRulesButRef)(I, a.self.RULES)) {
          const V = I.$ref;
          if (I = co.resolveRef.call(a.self, a.schemaEnv.root, a.baseId, V), I instanceof co.SchemaEnv && (I = I.schema), I === void 0)
            throw new zm.default(a.opts.uriResolver, a.baseId, V);
        }
        const T = (y = I == null ? void 0 : I.properties) === null || y === void 0 ? void 0 : y[u];
        if (typeof T != "object")
          throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${u}"`);
        d = d && (_ || m(I)), $(T, R);
      }
      if (!d)
        throw new Error(`discriminator: "${u}" must be required`);
      return b;
      function m({ required: R }) {
        return Array.isArray(R) && R.includes(u);
      }
      function $(R, I) {
        if (R.const)
          P(R.const, I);
        else if (R.enum)
          for (const T of R.enum)
            P(T, I);
        else
          throw new Error(`discriminator: "properties/${u}" must have "const" or "enum"`);
      }
      function P(R, I) {
        if (typeof R != "string" || R in b)
          throw new Error(`discriminator: "${u}" values must be unique strings`);
        b[R] = I;
      }
    }
  }
};
nn.default = qm;
var ia = {};
const Km = "https://json-schema.org/draft/2020-12/schema", Hm = "https://json-schema.org/draft/2020-12/schema", Wm = {
  "https://json-schema.org/draft/2020-12/vocab/core": !0,
  "https://json-schema.org/draft/2020-12/vocab/applicator": !0,
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0,
  "https://json-schema.org/draft/2020-12/vocab/validation": !0,
  "https://json-schema.org/draft/2020-12/vocab/meta-data": !0,
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0,
  "https://json-schema.org/draft/2020-12/vocab/content": !0
}, xm = "meta", Bm = "Core and Validation specifications meta-schema", Xm = [
  {
    $ref: "meta/core"
  },
  {
    $ref: "meta/applicator"
  },
  {
    $ref: "meta/unevaluated"
  },
  {
    $ref: "meta/validation"
  },
  {
    $ref: "meta/meta-data"
  },
  {
    $ref: "meta/format-annotation"
  },
  {
    $ref: "meta/content"
  }
], Ym = [
  "object",
  "boolean"
], Jm = "This meta-schema also defines keywords that have appeared in previous drafts in order to prevent incompatible extensions as they remain in common use.", Zm = {
  definitions: {
    $comment: '"definitions" has been replaced by "$defs".',
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    deprecated: !0,
    default: {}
  },
  dependencies: {
    $comment: '"dependencies" has been split and replaced by "dependentSchemas" and "dependentRequired" in order to serve their differing semantics.',
    type: "object",
    additionalProperties: {
      anyOf: [
        {
          $dynamicRef: "#meta"
        },
        {
          $ref: "meta/validation#/$defs/stringArray"
        }
      ]
    },
    deprecated: !0,
    default: {}
  },
  $recursiveAnchor: {
    $comment: '"$recursiveAnchor" has been replaced by "$dynamicAnchor".',
    $ref: "meta/core#/$defs/anchorString",
    deprecated: !0
  },
  $recursiveRef: {
    $comment: '"$recursiveRef" has been replaced by "$dynamicRef".',
    $ref: "meta/core#/$defs/uriReferenceString",
    deprecated: !0
  }
}, Qm = {
  $schema: Km,
  $id: Hm,
  $vocabulary: Wm,
  $dynamicAnchor: xm,
  title: Bm,
  allOf: Xm,
  type: Ym,
  $comment: Jm,
  properties: Zm
}, ep = "https://json-schema.org/draft/2020-12/schema", tp = "https://json-schema.org/draft/2020-12/meta/applicator", rp = {
  "https://json-schema.org/draft/2020-12/vocab/applicator": !0
}, np = "meta", sp = "Applicator vocabulary meta-schema", ap = [
  "object",
  "boolean"
], op = {
  prefixItems: {
    $ref: "#/$defs/schemaArray"
  },
  items: {
    $dynamicRef: "#meta"
  },
  contains: {
    $dynamicRef: "#meta"
  },
  additionalProperties: {
    $dynamicRef: "#meta"
  },
  properties: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    default: {}
  },
  patternProperties: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    propertyNames: {
      format: "regex"
    },
    default: {}
  },
  dependentSchemas: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    },
    default: {}
  },
  propertyNames: {
    $dynamicRef: "#meta"
  },
  if: {
    $dynamicRef: "#meta"
  },
  then: {
    $dynamicRef: "#meta"
  },
  else: {
    $dynamicRef: "#meta"
  },
  allOf: {
    $ref: "#/$defs/schemaArray"
  },
  anyOf: {
    $ref: "#/$defs/schemaArray"
  },
  oneOf: {
    $ref: "#/$defs/schemaArray"
  },
  not: {
    $dynamicRef: "#meta"
  }
}, ip = {
  schemaArray: {
    type: "array",
    minItems: 1,
    items: {
      $dynamicRef: "#meta"
    }
  }
}, cp = {
  $schema: ep,
  $id: tp,
  $vocabulary: rp,
  $dynamicAnchor: np,
  title: sp,
  type: ap,
  properties: op,
  $defs: ip
}, up = "https://json-schema.org/draft/2020-12/schema", lp = "https://json-schema.org/draft/2020-12/meta/unevaluated", fp = {
  "https://json-schema.org/draft/2020-12/vocab/unevaluated": !0
}, dp = "meta", hp = "Unevaluated applicator vocabulary meta-schema", mp = [
  "object",
  "boolean"
], pp = {
  unevaluatedItems: {
    $dynamicRef: "#meta"
  },
  unevaluatedProperties: {
    $dynamicRef: "#meta"
  }
}, yp = {
  $schema: up,
  $id: lp,
  $vocabulary: fp,
  $dynamicAnchor: dp,
  title: hp,
  type: mp,
  properties: pp
}, $p = "https://json-schema.org/draft/2020-12/schema", gp = "https://json-schema.org/draft/2020-12/meta/content", vp = {
  "https://json-schema.org/draft/2020-12/vocab/content": !0
}, _p = "meta", Ep = "Content vocabulary meta-schema", wp = [
  "object",
  "boolean"
], Sp = {
  contentEncoding: {
    type: "string"
  },
  contentMediaType: {
    type: "string"
  },
  contentSchema: {
    $dynamicRef: "#meta"
  }
}, bp = {
  $schema: $p,
  $id: gp,
  $vocabulary: vp,
  $dynamicAnchor: _p,
  title: Ep,
  type: wp,
  properties: Sp
}, Pp = "https://json-schema.org/draft/2020-12/schema", Rp = "https://json-schema.org/draft/2020-12/meta/core", Op = {
  "https://json-schema.org/draft/2020-12/vocab/core": !0
}, Ip = "meta", Np = "Core vocabulary meta-schema", Tp = [
  "object",
  "boolean"
], jp = {
  $id: {
    $ref: "#/$defs/uriReferenceString",
    $comment: "Non-empty fragments not allowed.",
    pattern: "^[^#]*#?$"
  },
  $schema: {
    $ref: "#/$defs/uriString"
  },
  $ref: {
    $ref: "#/$defs/uriReferenceString"
  },
  $anchor: {
    $ref: "#/$defs/anchorString"
  },
  $dynamicRef: {
    $ref: "#/$defs/uriReferenceString"
  },
  $dynamicAnchor: {
    $ref: "#/$defs/anchorString"
  },
  $vocabulary: {
    type: "object",
    propertyNames: {
      $ref: "#/$defs/uriString"
    },
    additionalProperties: {
      type: "boolean"
    }
  },
  $comment: {
    type: "string"
  },
  $defs: {
    type: "object",
    additionalProperties: {
      $dynamicRef: "#meta"
    }
  }
}, Ap = {
  anchorString: {
    type: "string",
    pattern: "^[A-Za-z_][-A-Za-z0-9._]*$"
  },
  uriString: {
    type: "string",
    format: "uri"
  },
  uriReferenceString: {
    type: "string",
    format: "uri-reference"
  }
}, kp = {
  $schema: Pp,
  $id: Rp,
  $vocabulary: Op,
  $dynamicAnchor: Ip,
  title: Np,
  type: Tp,
  properties: jp,
  $defs: Ap
}, Cp = "https://json-schema.org/draft/2020-12/schema", Dp = "https://json-schema.org/draft/2020-12/meta/format-annotation", Lp = {
  "https://json-schema.org/draft/2020-12/vocab/format-annotation": !0
}, Mp = "meta", Fp = "Format vocabulary meta-schema for annotation results", Vp = [
  "object",
  "boolean"
], zp = {
  format: {
    type: "string"
  }
}, Up = {
  $schema: Cp,
  $id: Dp,
  $vocabulary: Lp,
  $dynamicAnchor: Mp,
  title: Fp,
  type: Vp,
  properties: zp
}, Gp = "https://json-schema.org/draft/2020-12/schema", qp = "https://json-schema.org/draft/2020-12/meta/meta-data", Kp = {
  "https://json-schema.org/draft/2020-12/vocab/meta-data": !0
}, Hp = "meta", Wp = "Meta-data vocabulary meta-schema", xp = [
  "object",
  "boolean"
], Bp = {
  title: {
    type: "string"
  },
  description: {
    type: "string"
  },
  default: !0,
  deprecated: {
    type: "boolean",
    default: !1
  },
  readOnly: {
    type: "boolean",
    default: !1
  },
  writeOnly: {
    type: "boolean",
    default: !1
  },
  examples: {
    type: "array",
    items: !0
  }
}, Xp = {
  $schema: Gp,
  $id: qp,
  $vocabulary: Kp,
  $dynamicAnchor: Hp,
  title: Wp,
  type: xp,
  properties: Bp
}, Yp = "https://json-schema.org/draft/2020-12/schema", Jp = "https://json-schema.org/draft/2020-12/meta/validation", Zp = {
  "https://json-schema.org/draft/2020-12/vocab/validation": !0
}, Qp = "meta", ey = "Validation vocabulary meta-schema", ty = [
  "object",
  "boolean"
], ry = {
  type: {
    anyOf: [
      {
        $ref: "#/$defs/simpleTypes"
      },
      {
        type: "array",
        items: {
          $ref: "#/$defs/simpleTypes"
        },
        minItems: 1,
        uniqueItems: !0
      }
    ]
  },
  const: !0,
  enum: {
    type: "array",
    items: !0
  },
  multipleOf: {
    type: "number",
    exclusiveMinimum: 0
  },
  maximum: {
    type: "number"
  },
  exclusiveMaximum: {
    type: "number"
  },
  minimum: {
    type: "number"
  },
  exclusiveMinimum: {
    type: "number"
  },
  maxLength: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minLength: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  pattern: {
    type: "string",
    format: "regex"
  },
  maxItems: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minItems: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  uniqueItems: {
    type: "boolean",
    default: !1
  },
  maxContains: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minContains: {
    $ref: "#/$defs/nonNegativeInteger",
    default: 1
  },
  maxProperties: {
    $ref: "#/$defs/nonNegativeInteger"
  },
  minProperties: {
    $ref: "#/$defs/nonNegativeIntegerDefault0"
  },
  required: {
    $ref: "#/$defs/stringArray"
  },
  dependentRequired: {
    type: "object",
    additionalProperties: {
      $ref: "#/$defs/stringArray"
    }
  }
}, ny = {
  nonNegativeInteger: {
    type: "integer",
    minimum: 0
  },
  nonNegativeIntegerDefault0: {
    $ref: "#/$defs/nonNegativeInteger",
    default: 0
  },
  simpleTypes: {
    enum: [
      "array",
      "boolean",
      "integer",
      "null",
      "number",
      "object",
      "string"
    ]
  },
  stringArray: {
    type: "array",
    items: {
      type: "string"
    },
    uniqueItems: !0,
    default: []
  }
}, sy = {
  $schema: Yp,
  $id: Jp,
  $vocabulary: Zp,
  $dynamicAnchor: Qp,
  title: ey,
  type: ty,
  properties: ry,
  $defs: ny
};
Object.defineProperty(ia, "__esModule", { value: !0 });
const ay = Qm, oy = cp, iy = yp, cy = bp, uy = kp, ly = Up, fy = Xp, dy = sy, hy = ["/properties"];
function my(e) {
  return [
    ay,
    oy,
    iy,
    cy,
    uy,
    t(this, ly),
    fy,
    t(this, dy)
  ].forEach((r) => this.addMetaSchema(r, void 0, !1)), this;
  function t(r, n) {
    return e ? r.$dataMetaSchema(n, hy) : n;
  }
}
ia.default = my;
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv2020 = void 0;
  const r = ls, n = Ps, s = nn, a = ia, o = "https://json-schema.org/draft/2020-12/schema";
  class u extends r.default {
    constructor(y = {}) {
      super({
        ...y,
        dynamicRef: !0,
        next: !0,
        unevaluated: !0
      });
    }
    _addVocabularies() {
      super._addVocabularies(), n.default.forEach((y) => this.addVocabulary(y)), this.opts.discriminator && this.addKeyword(s.default);
    }
    _addDefaultMetaSchema() {
      super._addDefaultMetaSchema();
      const { $data: y, meta: b } = this.opts;
      b && (a.default.call(this, y), this.refs["http://json-schema.org/schema"] = o);
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(o) ? o : void 0);
    }
  }
  t.Ajv2020 = u, e.exports = t = u, e.exports.Ajv2020 = u, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = u;
  var i = Ae;
  Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
    return i.KeywordCxt;
  } });
  var f = q;
  Object.defineProperty(t, "_", { enumerable: !0, get: function() {
    return f._;
  } }), Object.defineProperty(t, "str", { enumerable: !0, get: function() {
    return f.str;
  } }), Object.defineProperty(t, "stringify", { enumerable: !0, get: function() {
    return f.stringify;
  } }), Object.defineProperty(t, "nil", { enumerable: !0, get: function() {
    return f.nil;
  } }), Object.defineProperty(t, "Name", { enumerable: !0, get: function() {
    return f.Name;
  } }), Object.defineProperty(t, "CodeGen", { enumerable: !0, get: function() {
    return f.CodeGen;
  } });
  var c = Ft;
  Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
    return c.default;
  } });
  var p = Et;
  Object.defineProperty(t, "MissingRefError", { enumerable: !0, get: function() {
    return p.default;
  } });
})(Hn, Hn.exports);
var py = Hn.exports, Qn = { exports: {} }, Ji = {};
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.formatNames = e.fastFormats = e.fullFormats = void 0;
  function t(M, G) {
    return { validate: M, compare: G };
  }
  e.fullFormats = {
    // date: http://tools.ietf.org/html/rfc3339#section-5.6
    date: t(a, o),
    // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
    time: t(i(!0), f),
    "date-time": t(w(!0), y),
    "iso-time": t(i(), c),
    "iso-date-time": t(w(), b),
    // duration: https://tools.ietf.org/html/rfc3339#appendix-A
    duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
    uri: m,
    "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
    // uri-template: https://tools.ietf.org/html/rfc6570
    "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
    // For the source: https://gist.github.com/dperini/729294
    // For test cases: https://mathiasbynens.be/demo/url-regex
    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
    email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
    // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
    regex: de,
    // uuid: http://tools.ietf.org/html/rfc4122
    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    // JSON-pointer: https://tools.ietf.org/html/rfc6901
    // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
    "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
    "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
    // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
    "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
    // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
    // byte: https://github.com/miguelmota/is-base64
    byte: P,
    // signed 32 bit integer
    int32: { type: "number", validate: T },
    // signed 64 bit integer
    int64: { type: "number", validate: V },
    // C-type float
    float: { type: "number", validate: J },
    // C-type double
    double: { type: "number", validate: J },
    // hint to the UI to hide input strings
    password: !0,
    // unchecked string payload
    binary: !0
  }, e.fastFormats = {
    ...e.fullFormats,
    date: t(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, o),
    time: t(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, f),
    "date-time": t(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, y),
    "iso-time": t(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, c),
    "iso-date-time": t(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, b),
    // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    // email (sources from jsen validator):
    // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
    // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  }, e.formatNames = Object.keys(e.fullFormats);
  function r(M) {
    return M % 4 === 0 && (M % 100 !== 0 || M % 400 === 0);
  }
  const n = /^(\d\d\d\d)-(\d\d)-(\d\d)$/, s = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function a(M) {
    const G = n.exec(M);
    if (!G)
      return !1;
    const Z = +G[1], K = +G[2], oe = +G[3];
    return K >= 1 && K <= 12 && oe >= 1 && oe <= (K === 2 && r(Z) ? 29 : s[K]);
  }
  function o(M, G) {
    if (M && G)
      return M > G ? 1 : M < G ? -1 : 0;
  }
  const u = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
  function i(M) {
    return function(Z) {
      const K = u.exec(Z);
      if (!K)
        return !1;
      const oe = +K[1], Se = +K[2], k = +K[3], A = K[4], D = K[5] === "-" ? -1 : 1, O = +(K[6] || 0), g = +(K[7] || 0);
      if (O > 23 || g > 59 || M && !A)
        return !1;
      if (oe <= 23 && Se <= 59 && k < 60)
        return !0;
      const S = Se - g * D, v = oe - O * D - (S < 0 ? 1 : 0);
      return (v === 23 || v === -1) && (S === 59 || S === -1) && k < 61;
    };
  }
  function f(M, G) {
    if (!(M && G))
      return;
    const Z = (/* @__PURE__ */ new Date("2020-01-01T" + M)).valueOf(), K = (/* @__PURE__ */ new Date("2020-01-01T" + G)).valueOf();
    if (Z && K)
      return Z - K;
  }
  function c(M, G) {
    if (!(M && G))
      return;
    const Z = u.exec(M), K = u.exec(G);
    if (Z && K)
      return M = Z[1] + Z[2] + Z[3], G = K[1] + K[2] + K[3], M > G ? 1 : M < G ? -1 : 0;
  }
  const p = /t|\s/i;
  function w(M) {
    const G = i(M);
    return function(K) {
      const oe = K.split(p);
      return oe.length === 2 && a(oe[0]) && G(oe[1]);
    };
  }
  function y(M, G) {
    if (!(M && G))
      return;
    const Z = new Date(M).valueOf(), K = new Date(G).valueOf();
    if (Z && K)
      return Z - K;
  }
  function b(M, G) {
    if (!(M && G))
      return;
    const [Z, K] = M.split(p), [oe, Se] = G.split(p), k = o(Z, oe);
    if (k !== void 0)
      return k || f(K, Se);
  }
  const _ = /\/|:/, d = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function m(M) {
    return _.test(M) && d.test(M);
  }
  const $ = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
  function P(M) {
    return $.lastIndex = 0, $.test(M);
  }
  const R = -2147483648, I = 2 ** 31 - 1;
  function T(M) {
    return Number.isInteger(M) && M <= I && M >= R;
  }
  function V(M) {
    return Number.isInteger(M);
  }
  function J() {
    return !0;
  }
  const ae = /[^\\]\\Z/;
  function de(M) {
    if (ae.test(M))
      return !1;
    try {
      return new RegExp(M), !0;
    } catch {
      return !1;
    }
  }
})(Ji);
var Zi = {}, es = { exports: {} }, ca = {};
Object.defineProperty(ca, "__esModule", { value: !0 });
const yy = Jr, $y = Zr, gy = Qr, vy = rn, uo = _t, _y = [
  yy.default,
  $y.default,
  (0, gy.default)(),
  vy.default,
  uo.metadataVocabulary,
  uo.contentVocabulary
];
ca.default = _y;
const Ey = "http://json-schema.org/draft-07/schema#", wy = "http://json-schema.org/draft-07/schema#", Sy = "Core schema meta-schema", by = {
  schemaArray: {
    type: "array",
    minItems: 1,
    items: {
      $ref: "#"
    }
  },
  nonNegativeInteger: {
    type: "integer",
    minimum: 0
  },
  nonNegativeIntegerDefault0: {
    allOf: [
      {
        $ref: "#/definitions/nonNegativeInteger"
      },
      {
        default: 0
      }
    ]
  },
  simpleTypes: {
    enum: [
      "array",
      "boolean",
      "integer",
      "null",
      "number",
      "object",
      "string"
    ]
  },
  stringArray: {
    type: "array",
    items: {
      type: "string"
    },
    uniqueItems: !0,
    default: []
  }
}, Py = [
  "object",
  "boolean"
], Ry = {
  $id: {
    type: "string",
    format: "uri-reference"
  },
  $schema: {
    type: "string",
    format: "uri"
  },
  $ref: {
    type: "string",
    format: "uri-reference"
  },
  $comment: {
    type: "string"
  },
  title: {
    type: "string"
  },
  description: {
    type: "string"
  },
  default: !0,
  readOnly: {
    type: "boolean",
    default: !1
  },
  examples: {
    type: "array",
    items: !0
  },
  multipleOf: {
    type: "number",
    exclusiveMinimum: 0
  },
  maximum: {
    type: "number"
  },
  exclusiveMaximum: {
    type: "number"
  },
  minimum: {
    type: "number"
  },
  exclusiveMinimum: {
    type: "number"
  },
  maxLength: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minLength: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  pattern: {
    type: "string",
    format: "regex"
  },
  additionalItems: {
    $ref: "#"
  },
  items: {
    anyOf: [
      {
        $ref: "#"
      },
      {
        $ref: "#/definitions/schemaArray"
      }
    ],
    default: !0
  },
  maxItems: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minItems: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  uniqueItems: {
    type: "boolean",
    default: !1
  },
  contains: {
    $ref: "#"
  },
  maxProperties: {
    $ref: "#/definitions/nonNegativeInteger"
  },
  minProperties: {
    $ref: "#/definitions/nonNegativeIntegerDefault0"
  },
  required: {
    $ref: "#/definitions/stringArray"
  },
  additionalProperties: {
    $ref: "#"
  },
  definitions: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    default: {}
  },
  properties: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    default: {}
  },
  patternProperties: {
    type: "object",
    additionalProperties: {
      $ref: "#"
    },
    propertyNames: {
      format: "regex"
    },
    default: {}
  },
  dependencies: {
    type: "object",
    additionalProperties: {
      anyOf: [
        {
          $ref: "#"
        },
        {
          $ref: "#/definitions/stringArray"
        }
      ]
    }
  },
  propertyNames: {
    $ref: "#"
  },
  const: !0,
  enum: {
    type: "array",
    items: !0,
    minItems: 1,
    uniqueItems: !0
  },
  type: {
    anyOf: [
      {
        $ref: "#/definitions/simpleTypes"
      },
      {
        type: "array",
        items: {
          $ref: "#/definitions/simpleTypes"
        },
        minItems: 1,
        uniqueItems: !0
      }
    ]
  },
  format: {
    type: "string"
  },
  contentMediaType: {
    type: "string"
  },
  contentEncoding: {
    type: "string"
  },
  if: {
    $ref: "#"
  },
  then: {
    $ref: "#"
  },
  else: {
    $ref: "#"
  },
  allOf: {
    $ref: "#/definitions/schemaArray"
  },
  anyOf: {
    $ref: "#/definitions/schemaArray"
  },
  oneOf: {
    $ref: "#/definitions/schemaArray"
  },
  not: {
    $ref: "#"
  }
}, Oy = {
  $schema: Ey,
  $id: wy,
  title: Sy,
  definitions: by,
  type: Py,
  properties: Ry,
  default: !0
};
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 }), t.MissingRefError = t.ValidationError = t.CodeGen = t.Name = t.nil = t.stringify = t.str = t._ = t.KeywordCxt = t.Ajv = void 0;
  const r = ls, n = ca, s = nn, a = Oy, o = ["/properties"], u = "http://json-schema.org/draft-07/schema";
  class i extends r.default {
    _addVocabularies() {
      super._addVocabularies(), n.default.forEach((b) => this.addVocabulary(b)), this.opts.discriminator && this.addKeyword(s.default);
    }
    _addDefaultMetaSchema() {
      if (super._addDefaultMetaSchema(), !this.opts.meta)
        return;
      const b = this.opts.$data ? this.$dataMetaSchema(a, o) : a;
      this.addMetaSchema(b, u, !1), this.refs["http://json-schema.org/schema"] = u;
    }
    defaultMeta() {
      return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(u) ? u : void 0);
    }
  }
  t.Ajv = i, e.exports = t = i, e.exports.Ajv = i, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = i;
  var f = Ae;
  Object.defineProperty(t, "KeywordCxt", { enumerable: !0, get: function() {
    return f.KeywordCxt;
  } });
  var c = q;
  Object.defineProperty(t, "_", { enumerable: !0, get: function() {
    return c._;
  } }), Object.defineProperty(t, "str", { enumerable: !0, get: function() {
    return c.str;
  } }), Object.defineProperty(t, "stringify", { enumerable: !0, get: function() {
    return c.stringify;
  } }), Object.defineProperty(t, "nil", { enumerable: !0, get: function() {
    return c.nil;
  } }), Object.defineProperty(t, "Name", { enumerable: !0, get: function() {
    return c.Name;
  } }), Object.defineProperty(t, "CodeGen", { enumerable: !0, get: function() {
    return c.CodeGen;
  } });
  var p = Ft;
  Object.defineProperty(t, "ValidationError", { enumerable: !0, get: function() {
    return p.default;
  } });
  var w = Et;
  Object.defineProperty(t, "MissingRefError", { enumerable: !0, get: function() {
    return w.default;
  } });
})(es, es.exports);
var Iy = es.exports;
(function(e) {
  Object.defineProperty(e, "__esModule", { value: !0 }), e.formatLimitDefinition = void 0;
  const t = Iy, r = q, n = r.operators, s = {
    formatMaximum: { okStr: "<=", ok: n.LTE, fail: n.GT },
    formatMinimum: { okStr: ">=", ok: n.GTE, fail: n.LT },
    formatExclusiveMaximum: { okStr: "<", ok: n.LT, fail: n.GTE },
    formatExclusiveMinimum: { okStr: ">", ok: n.GT, fail: n.LTE }
  }, a = {
    message: ({ keyword: u, schemaCode: i }) => (0, r.str)`should be ${s[u].okStr} ${i}`,
    params: ({ keyword: u, schemaCode: i }) => (0, r._)`{comparison: ${s[u].okStr}, limit: ${i}}`
  };
  e.formatLimitDefinition = {
    keyword: Object.keys(s),
    type: "string",
    schemaType: "string",
    $data: !0,
    error: a,
    code(u) {
      const { gen: i, data: f, schemaCode: c, keyword: p, it: w } = u, { opts: y, self: b } = w;
      if (!y.validateFormats)
        return;
      const _ = new t.KeywordCxt(w, b.RULES.all.format.definition, "format");
      _.$data ? d() : m();
      function d() {
        const P = i.scopeValue("formats", {
          ref: b.formats,
          code: y.code.formats
        }), R = i.const("fmt", (0, r._)`${P}[${_.schemaCode}]`);
        u.fail$data((0, r.or)((0, r._)`typeof ${R} != "object"`, (0, r._)`${R} instanceof RegExp`, (0, r._)`typeof ${R}.compare != "function"`, $(R)));
      }
      function m() {
        const P = _.schema, R = b.formats[P];
        if (!R || R === !0)
          return;
        if (typeof R != "object" || R instanceof RegExp || typeof R.compare != "function")
          throw new Error(`"${p}": format "${P}" does not define "compare" function`);
        const I = i.scopeValue("formats", {
          key: P,
          ref: R,
          code: y.code.formats ? (0, r._)`${y.code.formats}${(0, r.getProperty)(P)}` : void 0
        });
        u.fail$data($(I));
      }
      function $(P) {
        return (0, r._)`${P}.compare(${f}, ${c}) ${s[p].fail} 0`;
      }
    },
    dependencies: ["format"]
  };
  const o = (u) => (u.addKeyword(e.formatLimitDefinition), u);
  e.default = o;
})(Zi);
(function(e, t) {
  Object.defineProperty(t, "__esModule", { value: !0 });
  const r = Ji, n = Zi, s = q, a = new s.Name("fullFormats"), o = new s.Name("fastFormats"), u = (f, c = { keywords: !0 }) => {
    if (Array.isArray(c))
      return i(f, c, r.fullFormats, a), f;
    const [p, w] = c.mode === "fast" ? [r.fastFormats, o] : [r.fullFormats, a], y = c.formats || r.formatNames;
    return i(f, y, p, w), c.keywords && (0, n.default)(f), f;
  };
  u.get = (f, c = "full") => {
    const w = (c === "fast" ? r.fastFormats : r.fullFormats)[f];
    if (!w)
      throw new Error(`Unknown format "${f}"`);
    return w;
  };
  function i(f, c, p, w) {
    var y, b;
    (y = (b = f.opts.code).formats) !== null && y !== void 0 || (b.formats = (0, s._)`require("ajv-formats/dist/formats").${w}`);
    for (const _ of c)
      f.addFormat(_, p[_]);
  }
  e.exports = t = u, Object.defineProperty(t, "__esModule", { value: !0 }), t.default = u;
})(Qn, Qn.exports);
var Ny = Qn.exports;
const Ty = /* @__PURE__ */ is(Ny), jy = (e, t, r, n) => {
  if (r === "length" || r === "prototype" || r === "arguments" || r === "caller")
    return;
  const s = Object.getOwnPropertyDescriptor(e, r), a = Object.getOwnPropertyDescriptor(t, r);
  !Ay(s, a) && n || Object.defineProperty(e, r, a);
}, Ay = function(e, t) {
  return e === void 0 || e.configurable || e.writable === t.writable && e.enumerable === t.enumerable && e.configurable === t.configurable && (e.writable || e.value === t.value);
}, ky = (e, t) => {
  const r = Object.getPrototypeOf(t);
  r !== Object.getPrototypeOf(e) && Object.setPrototypeOf(e, r);
}, Cy = (e, t) => `/* Wrapped ${e}*/
${t}`, Dy = Object.getOwnPropertyDescriptor(Function.prototype, "toString"), Ly = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name"), My = (e, t, r) => {
  const n = r === "" ? "" : `with ${r.trim()}() `, s = Cy.bind(null, n, t.toString());
  Object.defineProperty(s, "name", Ly);
  const { writable: a, enumerable: o, configurable: u } = Dy;
  Object.defineProperty(e, "toString", { value: s, writable: a, enumerable: o, configurable: u });
};
function Fy(e, t, { ignoreNonConfigurable: r = !1 } = {}) {
  const { name: n } = e;
  for (const s of Reflect.ownKeys(t))
    jy(e, t, s, r);
  return ky(e, t), My(e, t, n), e;
}
const lo = (e, t = {}) => {
  if (typeof e != "function")
    throw new TypeError(`Expected the first argument to be a function, got \`${typeof e}\``);
  const {
    wait: r = 0,
    maxWait: n = Number.POSITIVE_INFINITY,
    before: s = !1,
    after: a = !0
  } = t;
  if (r < 0 || n < 0)
    throw new RangeError("`wait` and `maxWait` must not be negative.");
  if (!s && !a)
    throw new Error("Both `before` and `after` are false, function wouldn't be called.");
  let o, u, i;
  const f = function(...c) {
    const p = this, w = () => {
      o = void 0, u && (clearTimeout(u), u = void 0), a && (i = e.apply(p, c));
    }, y = () => {
      u = void 0, o && (clearTimeout(o), o = void 0), a && (i = e.apply(p, c));
    }, b = s && !o;
    return clearTimeout(o), o = setTimeout(w, r), n > 0 && n !== Number.POSITIVE_INFINITY && !u && (u = setTimeout(y, n)), b && (i = e.apply(p, c)), i;
  };
  return Fy(f, e), f.cancel = () => {
    o && (clearTimeout(o), o = void 0), u && (clearTimeout(u), u = void 0);
  }, f;
};
var ts = { exports: {} };
const Vy = "2.0.0", Qi = 256, zy = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
9007199254740991, Uy = 16, Gy = Qi - 6, qy = [
  "major",
  "premajor",
  "minor",
  "preminor",
  "patch",
  "prepatch",
  "prerelease"
];
var ar = {
  MAX_LENGTH: Qi,
  MAX_SAFE_COMPONENT_LENGTH: Uy,
  MAX_SAFE_BUILD_LENGTH: Gy,
  MAX_SAFE_INTEGER: zy,
  RELEASE_TYPES: qy,
  SEMVER_SPEC_VERSION: Vy,
  FLAG_INCLUDE_PRERELEASE: 1,
  FLAG_LOOSE: 2
};
const Ky = typeof process == "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...e) => console.error("SEMVER", ...e) : () => {
};
var an = Ky;
(function(e, t) {
  const {
    MAX_SAFE_COMPONENT_LENGTH: r,
    MAX_SAFE_BUILD_LENGTH: n,
    MAX_LENGTH: s
  } = ar, a = an;
  t = e.exports = {};
  const o = t.re = [], u = t.safeRe = [], i = t.src = [], f = t.safeSrc = [], c = t.t = {};
  let p = 0;
  const w = "[a-zA-Z0-9-]", y = [
    ["\\s", 1],
    ["\\d", s],
    [w, n]
  ], b = (d) => {
    for (const [m, $] of y)
      d = d.split(`${m}*`).join(`${m}{0,${$}}`).split(`${m}+`).join(`${m}{1,${$}}`);
    return d;
  }, _ = (d, m, $) => {
    const P = b(m), R = p++;
    a(d, R, m), c[d] = R, i[R] = m, f[R] = P, o[R] = new RegExp(m, $ ? "g" : void 0), u[R] = new RegExp(P, $ ? "g" : void 0);
  };
  _("NUMERICIDENTIFIER", "0|[1-9]\\d*"), _("NUMERICIDENTIFIERLOOSE", "\\d+"), _("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${w}*`), _("MAINVERSION", `(${i[c.NUMERICIDENTIFIER]})\\.(${i[c.NUMERICIDENTIFIER]})\\.(${i[c.NUMERICIDENTIFIER]})`), _("MAINVERSIONLOOSE", `(${i[c.NUMERICIDENTIFIERLOOSE]})\\.(${i[c.NUMERICIDENTIFIERLOOSE]})\\.(${i[c.NUMERICIDENTIFIERLOOSE]})`), _("PRERELEASEIDENTIFIER", `(?:${i[c.NONNUMERICIDENTIFIER]}|${i[c.NUMERICIDENTIFIER]})`), _("PRERELEASEIDENTIFIERLOOSE", `(?:${i[c.NONNUMERICIDENTIFIER]}|${i[c.NUMERICIDENTIFIERLOOSE]})`), _("PRERELEASE", `(?:-(${i[c.PRERELEASEIDENTIFIER]}(?:\\.${i[c.PRERELEASEIDENTIFIER]})*))`), _("PRERELEASELOOSE", `(?:-?(${i[c.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${i[c.PRERELEASEIDENTIFIERLOOSE]})*))`), _("BUILDIDENTIFIER", `${w}+`), _("BUILD", `(?:\\+(${i[c.BUILDIDENTIFIER]}(?:\\.${i[c.BUILDIDENTIFIER]})*))`), _("FULLPLAIN", `v?${i[c.MAINVERSION]}${i[c.PRERELEASE]}?${i[c.BUILD]}?`), _("FULL", `^${i[c.FULLPLAIN]}$`), _("LOOSEPLAIN", `[v=\\s]*${i[c.MAINVERSIONLOOSE]}${i[c.PRERELEASELOOSE]}?${i[c.BUILD]}?`), _("LOOSE", `^${i[c.LOOSEPLAIN]}$`), _("GTLT", "((?:<|>)?=?)"), _("XRANGEIDENTIFIERLOOSE", `${i[c.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`), _("XRANGEIDENTIFIER", `${i[c.NUMERICIDENTIFIER]}|x|X|\\*`), _("XRANGEPLAIN", `[v=\\s]*(${i[c.XRANGEIDENTIFIER]})(?:\\.(${i[c.XRANGEIDENTIFIER]})(?:\\.(${i[c.XRANGEIDENTIFIER]})(?:${i[c.PRERELEASE]})?${i[c.BUILD]}?)?)?`), _("XRANGEPLAINLOOSE", `[v=\\s]*(${i[c.XRANGEIDENTIFIERLOOSE]})(?:\\.(${i[c.XRANGEIDENTIFIERLOOSE]})(?:\\.(${i[c.XRANGEIDENTIFIERLOOSE]})(?:${i[c.PRERELEASELOOSE]})?${i[c.BUILD]}?)?)?`), _("XRANGE", `^${i[c.GTLT]}\\s*${i[c.XRANGEPLAIN]}$`), _("XRANGELOOSE", `^${i[c.GTLT]}\\s*${i[c.XRANGEPLAINLOOSE]}$`), _("COERCEPLAIN", `(^|[^\\d])(\\d{1,${r}})(?:\\.(\\d{1,${r}}))?(?:\\.(\\d{1,${r}}))?`), _("COERCE", `${i[c.COERCEPLAIN]}(?:$|[^\\d])`), _("COERCEFULL", i[c.COERCEPLAIN] + `(?:${i[c.PRERELEASE]})?(?:${i[c.BUILD]})?(?:$|[^\\d])`), _("COERCERTL", i[c.COERCE], !0), _("COERCERTLFULL", i[c.COERCEFULL], !0), _("LONETILDE", "(?:~>?)"), _("TILDETRIM", `(\\s*)${i[c.LONETILDE]}\\s+`, !0), t.tildeTrimReplace = "$1~", _("TILDE", `^${i[c.LONETILDE]}${i[c.XRANGEPLAIN]}$`), _("TILDELOOSE", `^${i[c.LONETILDE]}${i[c.XRANGEPLAINLOOSE]}$`), _("LONECARET", "(?:\\^)"), _("CARETTRIM", `(\\s*)${i[c.LONECARET]}\\s+`, !0), t.caretTrimReplace = "$1^", _("CARET", `^${i[c.LONECARET]}${i[c.XRANGEPLAIN]}$`), _("CARETLOOSE", `^${i[c.LONECARET]}${i[c.XRANGEPLAINLOOSE]}$`), _("COMPARATORLOOSE", `^${i[c.GTLT]}\\s*(${i[c.LOOSEPLAIN]})$|^$`), _("COMPARATOR", `^${i[c.GTLT]}\\s*(${i[c.FULLPLAIN]})$|^$`), _("COMPARATORTRIM", `(\\s*)${i[c.GTLT]}\\s*(${i[c.LOOSEPLAIN]}|${i[c.XRANGEPLAIN]})`, !0), t.comparatorTrimReplace = "$1$2$3", _("HYPHENRANGE", `^\\s*(${i[c.XRANGEPLAIN]})\\s+-\\s+(${i[c.XRANGEPLAIN]})\\s*$`), _("HYPHENRANGELOOSE", `^\\s*(${i[c.XRANGEPLAINLOOSE]})\\s+-\\s+(${i[c.XRANGEPLAINLOOSE]})\\s*$`), _("STAR", "(<|>)?=?\\s*\\*"), _("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$"), _("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
})(ts, ts.exports);
var or = ts.exports;
const Hy = Object.freeze({ loose: !0 }), Wy = Object.freeze({}), xy = (e) => e ? typeof e != "object" ? Hy : e : Wy;
var ua = xy;
const fo = /^[0-9]+$/, ec = (e, t) => {
  if (typeof e == "number" && typeof t == "number")
    return e === t ? 0 : e < t ? -1 : 1;
  const r = fo.test(e), n = fo.test(t);
  return r && n && (e = +e, t = +t), e === t ? 0 : r && !n ? -1 : n && !r ? 1 : e < t ? -1 : 1;
}, By = (e, t) => ec(t, e);
var tc = {
  compareIdentifiers: ec,
  rcompareIdentifiers: By
};
const $r = an, { MAX_LENGTH: ho, MAX_SAFE_INTEGER: gr } = ar, { safeRe: vr, t: _r } = or, Xy = ua, { compareIdentifiers: rs } = tc, Yy = (e, t) => {
  const r = t.split(".");
  if (r.length > e.length)
    return !1;
  for (let n = 0; n < r.length; n++)
    if (rs(e[n], r[n]) !== 0)
      return !1;
  return !0;
};
let Jy = class Fe {
  constructor(t, r) {
    if (r = Xy(r), t instanceof Fe) {
      if (t.loose === !!r.loose && t.includePrerelease === !!r.includePrerelease)
        return t;
      t = t.version;
    } else if (typeof t != "string")
      throw new TypeError(`Invalid version. Must be a string. Got type "${typeof t}".`);
    if (t.length > ho)
      throw new TypeError(
        `version is longer than ${ho} characters`
      );
    $r("SemVer", t, r), this.options = r, this.loose = !!r.loose, this.includePrerelease = !!r.includePrerelease;
    const n = t.trim().match(r.loose ? vr[_r.LOOSE] : vr[_r.FULL]);
    if (!n)
      throw new TypeError(`Invalid Version: ${t}`);
    if (this.raw = t, this.major = +n[1], this.minor = +n[2], this.patch = +n[3], this.major > gr || this.major < 0)
      throw new TypeError("Invalid major version");
    if (this.minor > gr || this.minor < 0)
      throw new TypeError("Invalid minor version");
    if (this.patch > gr || this.patch < 0)
      throw new TypeError("Invalid patch version");
    n[4] ? this.prerelease = n[4].split(".").map((s) => {
      if (/^[0-9]+$/.test(s)) {
        const a = +s;
        if (a >= 0 && a < gr)
          return a;
      }
      return s;
    }) : this.prerelease = [], this.build = n[5] ? n[5].split(".") : [], this.format();
  }
  format() {
    return this.version = `${this.major}.${this.minor}.${this.patch}`, this.prerelease.length && (this.version += `-${this.prerelease.join(".")}`), this.version;
  }
  toString() {
    return this.version;
  }
  compare(t) {
    if ($r("SemVer.compare", this.version, this.options, t), !(t instanceof Fe)) {
      if (typeof t == "string" && t === this.version)
        return 0;
      t = new Fe(t, this.options);
    }
    return t.version === this.version ? 0 : this.compareMain(t) || this.comparePre(t);
  }
  compareMain(t) {
    return t instanceof Fe || (t = new Fe(t, this.options)), this.major < t.major ? -1 : this.major > t.major ? 1 : this.minor < t.minor ? -1 : this.minor > t.minor ? 1 : this.patch < t.patch ? -1 : this.patch > t.patch ? 1 : 0;
  }
  comparePre(t) {
    if (t instanceof Fe || (t = new Fe(t, this.options)), this.prerelease.length && !t.prerelease.length)
      return -1;
    if (!this.prerelease.length && t.prerelease.length)
      return 1;
    if (!this.prerelease.length && !t.prerelease.length)
      return 0;
    let r = 0;
    do {
      const n = this.prerelease[r], s = t.prerelease[r];
      if ($r("prerelease compare", r, n, s), n === void 0 && s === void 0)
        return 0;
      if (s === void 0)
        return 1;
      if (n === void 0)
        return -1;
      if (n === s)
        continue;
      return rs(n, s);
    } while (++r);
  }
  compareBuild(t) {
    t instanceof Fe || (t = new Fe(t, this.options));
    let r = 0;
    do {
      const n = this.build[r], s = t.build[r];
      if ($r("build compare", r, n, s), n === void 0 && s === void 0)
        return 0;
      if (s === void 0)
        return 1;
      if (n === void 0)
        return -1;
      if (n === s)
        continue;
      return rs(n, s);
    } while (++r);
  }
  // preminor will bump the version up to the next minor release, and immediately
  // down to pre-release. premajor and prepatch work the same way.
  inc(t, r, n) {
    if (t.startsWith("pre")) {
      if (!r && n === !1)
        throw new Error("invalid increment argument: identifier is empty");
      if (r) {
        const s = `-${r}`.match(this.options.loose ? vr[_r.PRERELEASELOOSE] : vr[_r.PRERELEASE]);
        if (!s || s[1] !== r)
          throw new Error(`invalid identifier: ${r}`);
      }
    }
    switch (t) {
      case "premajor":
        this.prerelease.length = 0, this.patch = 0, this.minor = 0, this.major++, this.inc("pre", r, n);
        break;
      case "preminor":
        this.prerelease.length = 0, this.patch = 0, this.minor++, this.inc("pre", r, n);
        break;
      case "prepatch":
        this.prerelease.length = 0, this.inc("patch", r, n), this.inc("pre", r, n);
        break;
      case "prerelease":
        this.prerelease.length === 0 && this.inc("patch", r, n), this.inc("pre", r, n);
        break;
      case "release":
        if (this.prerelease.length === 0)
          throw new Error(`version ${this.raw} is not a prerelease`);
        this.prerelease.length = 0;
        break;
      case "major":
        (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) && this.major++, this.minor = 0, this.patch = 0, this.prerelease = [];
        break;
      case "minor":
        (this.patch !== 0 || this.prerelease.length === 0) && this.minor++, this.patch = 0, this.prerelease = [];
        break;
      case "patch":
        this.prerelease.length === 0 && this.patch++, this.prerelease = [];
        break;
      case "pre": {
        const s = Number(n) ? 1 : 0;
        if (this.prerelease.length === 0)
          this.prerelease = [s];
        else {
          let a = this.prerelease.length;
          for (; --a >= 0; )
            typeof this.prerelease[a] == "number" && (this.prerelease[a]++, a = -2);
          if (a === -1) {
            if (r === this.prerelease.join(".") && n === !1)
              throw new Error("invalid increment argument: identifier already exists");
            this.prerelease.push(s);
          }
        }
        if (r) {
          let a = [r, s];
          if (n === !1 && (a = [r]), Yy(this.prerelease, r)) {
            const o = this.prerelease[r.split(".").length];
            isNaN(o) && (this.prerelease = a);
          } else
            this.prerelease = a;
        }
        break;
      }
      default:
        throw new Error(`invalid increment argument: ${t}`);
    }
    return this.raw = this.format(), this.build.length && (this.raw += `+${this.build.join(".")}`), this;
  }
};
var _e = Jy;
const mo = _e, Zy = (e, t, r = !1) => {
  if (e instanceof mo)
    return e;
  try {
    return new mo(e, t);
  } catch (n) {
    if (!r)
      return null;
    throw n;
  }
};
var wt = Zy;
const Qy = wt, e$ = (e, t) => {
  const r = Qy(e, t);
  return r ? r.version : null;
};
var t$ = e$;
const r$ = wt, n$ = (e, t) => {
  const r = r$(e.trim().replace(/^[=v]+/, ""), t);
  return r ? r.version : null;
};
var s$ = n$;
const po = _e, a$ = (e, t, r, n, s) => {
  typeof r == "string" && (s = n, n = r, r = void 0);
  try {
    return new po(
      e instanceof po ? e.version : e,
      r
    ).inc(t, n, s).version;
  } catch {
    return null;
  }
};
var o$ = a$;
const yo = wt, i$ = (e, t) => {
  const r = yo(e, null, !0), n = yo(t, null, !0), s = r.compare(n);
  if (s === 0)
    return null;
  const a = s > 0, o = a ? r : n, u = a ? n : r, i = !!o.prerelease.length;
  if (!!u.prerelease.length && !i) {
    if (!u.patch && !u.minor)
      return "major";
    if (u.compareMain(o) === 0)
      return u.minor && !u.patch ? "minor" : "patch";
  }
  const c = i ? "pre" : "";
  return r.major !== n.major ? c + "major" : r.minor !== n.minor ? c + "minor" : r.patch !== n.patch ? c + "patch" : "prerelease";
};
var c$ = i$;
const u$ = _e, l$ = (e, t) => new u$(e, t).major;
var f$ = l$;
const d$ = _e, h$ = (e, t) => new d$(e, t).minor;
var m$ = h$;
const p$ = _e, y$ = (e, t) => new p$(e, t).patch;
var $$ = y$;
const g$ = wt, v$ = (e, t) => {
  const r = g$(e, t);
  return r && r.prerelease.length ? r.prerelease : null;
};
var _$ = v$;
const $o = _e, E$ = (e, t, r) => new $o(e, r).compare(new $o(t, r));
var Le = E$;
const w$ = Le, S$ = (e, t, r) => w$(t, e, r);
var b$ = S$;
const P$ = Le, R$ = (e, t) => P$(e, t, !0);
var O$ = R$;
const go = _e, I$ = (e, t, r) => {
  const n = new go(e, r), s = new go(t, r);
  return n.compare(s) || n.compareBuild(s);
};
var la = I$;
const N$ = la, T$ = (e, t) => e.sort((r, n) => N$(r, n, t));
var j$ = T$;
const A$ = la, k$ = (e, t) => e.sort((r, n) => A$(n, r, t));
var C$ = k$;
const D$ = Le, L$ = (e, t, r) => D$(e, t, r) > 0;
var on = L$;
const M$ = Le, F$ = (e, t, r) => M$(e, t, r) < 0;
var fa = F$;
const V$ = Le, z$ = (e, t, r) => V$(e, t, r) === 0;
var rc = z$;
const U$ = Le, G$ = (e, t, r) => U$(e, t, r) !== 0;
var nc = G$;
const q$ = Le, K$ = (e, t, r) => q$(e, t, r) >= 0;
var da = K$;
const H$ = Le, W$ = (e, t, r) => H$(e, t, r) <= 0;
var ha = W$;
const x$ = rc, B$ = nc, X$ = on, Y$ = da, J$ = fa, Z$ = ha, Q$ = (e, t, r, n) => {
  switch (t) {
    case "===":
      return typeof e == "object" && (e = e.version), typeof r == "object" && (r = r.version), e === r;
    case "!==":
      return typeof e == "object" && (e = e.version), typeof r == "object" && (r = r.version), e !== r;
    case "":
    case "=":
    case "==":
      return x$(e, r, n);
    case "!=":
      return B$(e, r, n);
    case ">":
      return X$(e, r, n);
    case ">=":
      return Y$(e, r, n);
    case "<":
      return J$(e, r, n);
    case "<=":
      return Z$(e, r, n);
    default:
      throw new TypeError(`Invalid operator: ${t}`);
  }
};
var sc = Q$;
const e0 = _e, t0 = wt, { safeRe: Er, t: wr } = or, r0 = (e, t) => {
  if (e instanceof e0)
    return e;
  if (typeof e == "number" && (e = String(e)), typeof e != "string")
    return null;
  t = t || {};
  let r = null;
  if (!t.rtl)
    r = e.match(t.includePrerelease ? Er[wr.COERCEFULL] : Er[wr.COERCE]);
  else {
    const i = t.includePrerelease ? Er[wr.COERCERTLFULL] : Er[wr.COERCERTL];
    let f;
    for (; (f = i.exec(e)) && (!r || r.index + r[0].length !== e.length); )
      (!r || f.index + f[0].length !== r.index + r[0].length) && (r = f), i.lastIndex = f.index + f[1].length + f[2].length;
    i.lastIndex = -1;
  }
  if (r === null)
    return null;
  const n = r[2], s = r[3] || "0", a = r[4] || "0", o = t.includePrerelease && r[5] ? `-${r[5]}` : "", u = t.includePrerelease && r[6] ? `+${r[6]}` : "";
  return t0(`${n}.${s}.${a}${o}${u}`, t);
};
var n0 = r0;
const s0 = wt, a0 = ar, o0 = _e, i0 = (e, t, r) => {
  if (!a0.RELEASE_TYPES.includes(t))
    return null;
  const n = c0(e, r);
  return n && u0(n, t);
}, c0 = (e, t) => {
  const r = e instanceof o0 ? e.version : e;
  return s0(r, t);
}, u0 = (e, t) => {
  if (l0(t))
    return e.version;
  switch (e.prerelease = [], t) {
    case "major":
      e.minor = 0, e.patch = 0;
      break;
    case "minor":
      e.patch = 0;
      break;
  }
  return e.format();
}, l0 = (e) => e.startsWith("pre");
var f0 = i0;
class d0 {
  constructor() {
    this.max = 1e3, this.map = /* @__PURE__ */ new Map();
  }
  get(t) {
    const r = this.map.get(t);
    if (r !== void 0)
      return this.map.delete(t), this.map.set(t, r), r;
  }
  delete(t) {
    return this.map.delete(t);
  }
  set(t, r) {
    if (!this.delete(t) && r !== void 0) {
      if (this.map.size >= this.max) {
        const s = this.map.keys().next().value;
        this.delete(s);
      }
      this.map.set(t, r);
    }
    return this;
  }
}
var h0 = d0, Cn, vo;
function Me() {
  if (vo)
    return Cn;
  vo = 1;
  const e = /\s+/g;
  class t {
    constructor(A, D) {
      if (D = s(D), A instanceof t)
        return A.loose === !!D.loose && A.includePrerelease === !!D.includePrerelease ? A : new t(A.raw, D);
      if (A instanceof a)
        return this.raw = A.value, this.set = [[A]], this.formatted = void 0, this;
      if (this.options = D, this.loose = !!D.loose, this.includePrerelease = !!D.includePrerelease, this.raw = A.trim().replace(e, " "), this.set = this.raw.split("||").map((O) => this.parseRange(O.trim())).filter((O) => O.length), !this.set.length)
        throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
      if (this.set.length > 1) {
        const O = this.set[0];
        if (this.set = this.set.filter((g) => !m(g[0])), this.set.length === 0)
          this.set = [O];
        else if (this.set.length > 1) {
          for (const g of this.set)
            if (g.length === 1 && $(g[0])) {
              this.set = [g];
              break;
            }
        }
      }
      this.formatted = void 0;
    }
    get range() {
      if (this.formatted === void 0) {
        this.formatted = "";
        for (let A = 0; A < this.set.length; A++) {
          A > 0 && (this.formatted += "||");
          const D = this.set[A];
          for (let O = 0; O < D.length; O++)
            O > 0 && (this.formatted += " "), this.formatted += D[O].toString().trim();
        }
      }
      return this.formatted;
    }
    format() {
      return this.range;
    }
    toString() {
      return this.range;
    }
    parseRange(A) {
      A = A.replace(d, "");
      const O = ((this.options.includePrerelease && b) | (this.options.loose && _)) + ":" + A, g = n.get(O);
      if (g)
        return g;
      const S = this.options.loose, v = S ? i[c.HYPHENRANGELOOSE] : i[c.HYPHENRANGE];
      A = A.replace(v, oe(this.options.includePrerelease)), o("hyphen replace", A), A = A.replace(i[c.COMPARATORTRIM], p), o("comparator trim", A), A = A.replace(i[c.TILDETRIM], w), o("tilde trim", A), A = A.replace(i[c.CARETTRIM], y), o("caret trim", A);
      let l = A.split(" ").map((j) => R(j, this.options)).join(" ").split(/\s+/).map((j) => K(j, this.options));
      S && (l = l.filter((j) => (o("loose invalid filter", j, this.options), !!j.match(i[c.COMPARATORLOOSE])))), o("range list", l);
      const h = /* @__PURE__ */ new Map(), E = l.map((j) => new a(j, this.options));
      for (const j of E) {
        if (m(j))
          return [j];
        h.set(j.value, j);
      }
      h.size > 1 && h.has("") && h.delete("");
      const N = [...h.values()];
      return n.set(O, N), N;
    }
    intersects(A, D) {
      if (!(A instanceof t))
        throw new TypeError("a Range is required");
      return this.set.some((O) => P(O, D) && A.set.some((g) => P(g, D) && O.every((S) => g.every((v) => S.intersects(v, D)))));
    }
    // if ANY of the sets match ALL of its comparators, then pass
    test(A) {
      if (!A)
        return !1;
      if (typeof A == "string")
        try {
          A = new u(A, this.options);
        } catch {
          return !1;
        }
      for (let D = 0; D < this.set.length; D++)
        if (Se(this.set[D], A, this.options))
          return !0;
      return !1;
    }
  }
  Cn = t;
  const r = h0, n = new r(), s = ua, a = cn(), o = an, u = _e, {
    safeRe: i,
    src: f,
    t: c,
    comparatorTrimReplace: p,
    tildeTrimReplace: w,
    caretTrimReplace: y
  } = or, { FLAG_INCLUDE_PRERELEASE: b, FLAG_LOOSE: _ } = ar, d = new RegExp(f[c.BUILD], "g"), m = (k) => k.value === "<0.0.0-0", $ = (k) => k.value === "", P = (k, A) => {
    let D = !0;
    const O = k.slice();
    let g = O.pop();
    for (; D && O.length; )
      D = O.every((S) => g.intersects(S, A)), g = O.pop();
    return D;
  }, R = (k, A) => (k = k.replace(i[c.BUILD], ""), o("comp", k, A), k = ae(k, A), o("caret", k), k = V(k, A), o("tildes", k), k = M(k, A), o("xrange", k), k = Z(k, A), o("stars", k), k), I = (k) => !k || k.toLowerCase() === "x" || k === "*", T = (k, A, D) => I(k) && !I(A) || I(A) && D && !I(D), V = (k, A) => k.trim().split(/\s+/).map((D) => J(D, A)).join(" "), J = (k, A) => {
    const D = A.loose ? i[c.TILDELOOSE] : i[c.TILDE], O = A.includePrerelease ? "-0" : "";
    return k.replace(D, (g, S, v, l, h) => {
      o("tilde", k, g, S, v, l, h);
      let E;
      return I(S) ? E = "" : I(v) ? E = `>=${S}.0.0${O} <${+S + 1}.0.0-0` : I(l) ? E = `>=${S}.${v}.0${O} <${S}.${+v + 1}.0-0` : h ? (o("replaceTilde pr", h), E = `>=${S}.${v}.${l}-${h} <${S}.${+v + 1}.0-0`) : E = `>=${S}.${v}.${l} <${S}.${+v + 1}.0-0`, o("tilde return", E), E;
    });
  }, ae = (k, A) => k.trim().split(/\s+/).map((D) => de(D, A)).join(" "), de = (k, A) => {
    o("caret", k, A);
    const D = A.loose ? i[c.CARETLOOSE] : i[c.CARET], O = A.includePrerelease ? "-0" : "";
    return k.replace(D, (g, S, v, l, h) => {
      o("caret", k, g, S, v, l, h);
      let E;
      return I(S) ? E = "" : I(v) ? E = `>=${S}.0.0${O} <${+S + 1}.0.0-0` : I(l) ? S === "0" ? E = `>=${S}.${v}.0${O} <${S}.${+v + 1}.0-0` : E = `>=${S}.${v}.0${O} <${+S + 1}.0.0-0` : h ? (o("replaceCaret pr", h), S === "0" ? v === "0" ? E = `>=${S}.${v}.${l}-${h} <${S}.${v}.${+l + 1}-0` : E = `>=${S}.${v}.${l}-${h} <${S}.${+v + 1}.0-0` : E = `>=${S}.${v}.${l}-${h} <${+S + 1}.0.0-0`) : (o("no pr"), S === "0" ? v === "0" ? E = `>=${S}.${v}.${l} <${S}.${v}.${+l + 1}-0` : E = `>=${S}.${v}.${l} <${S}.${+v + 1}.0-0` : E = `>=${S}.${v}.${l} <${+S + 1}.0.0-0`), o("caret return", E), E;
    });
  }, M = (k, A) => (o("replaceXRanges", k, A), k.split(/\s+/).map((D) => G(D, A)).join(" ")), G = (k, A) => {
    k = k.trim();
    const D = A.loose ? i[c.XRANGELOOSE] : i[c.XRANGE];
    return k.replace(D, (O, g, S, v, l, h) => {
      if (o("xRange", k, O, g, S, v, l, h), T(S, v, l))
        return k;
      const E = I(S), N = E || I(v), j = N || I(l), F = j;
      return g === "=" && F && (g = ""), h = A.includePrerelease ? "-0" : "", E ? g === ">" || g === "<" ? O = "<0.0.0-0" : O = "*" : g && F ? (N && (v = 0), l = 0, g === ">" ? (g = ">=", N ? (S = +S + 1, v = 0, l = 0) : (v = +v + 1, l = 0)) : g === "<=" && (g = "<", N ? S = +S + 1 : v = +v + 1), g === "<" && (h = "-0"), O = `${g + S}.${v}.${l}${h}`) : N ? O = `>=${S}.0.0${h} <${+S + 1}.0.0-0` : j && (O = `>=${S}.${v}.0${h} <${S}.${+v + 1}.0-0`), o("xRange return", O), O;
    });
  }, Z = (k, A) => (o("replaceStars", k, A), k.trim().replace(i[c.STAR], "")), K = (k, A) => (o("replaceGTE0", k, A), k.trim().replace(i[A.includePrerelease ? c.GTE0PRE : c.GTE0], "")), oe = (k) => (A, D, O, g, S, v, l, h, E, N, j, F) => (I(O) ? D = "" : I(g) ? D = `>=${O}.0.0${k ? "-0" : ""}` : I(S) ? D = `>=${O}.${g}.0${k ? "-0" : ""}` : v ? D = `>=${D}` : D = `>=${D}${k ? "-0" : ""}`, I(E) ? h = "" : I(N) ? h = `<${+E + 1}.0.0-0` : I(j) ? h = `<${E}.${+N + 1}.0-0` : F ? h = `<=${E}.${N}.${j}-${F}` : k ? h = `<${E}.${N}.${+j + 1}-0` : h = `<=${h}`, `${D} ${h}`.trim()), Se = (k, A, D) => {
    for (let O = 0; O < k.length; O++)
      if (!k[O].test(A))
        return !1;
    if (A.prerelease.length && !D.includePrerelease) {
      for (let O = 0; O < k.length; O++)
        if (o(k[O].semver), k[O].semver !== a.ANY && k[O].semver.prerelease.length > 0) {
          const g = k[O].semver;
          if (g.major === A.major && g.minor === A.minor && g.patch === A.patch)
            return !0;
        }
      return !1;
    }
    return !0;
  };
  return Cn;
}
var Dn, _o;
function cn() {
  if (_o)
    return Dn;
  _o = 1;
  const e = Symbol("SemVer ANY");
  class t {
    static get ANY() {
      return e;
    }
    constructor(c, p) {
      if (p = r(p), c instanceof t) {
        if (c.loose === !!p.loose)
          return c;
        c = c.value;
      }
      c = c.trim().split(/\s+/).join(" "), o("comparator", c, p), this.options = p, this.loose = !!p.loose, this.parse(c), this.semver === e ? this.value = "" : this.value = this.operator + this.semver.version, o("comp", this);
    }
    parse(c) {
      const p = this.options.loose ? n[s.COMPARATORLOOSE] : n[s.COMPARATOR], w = c.match(p);
      if (!w)
        throw new TypeError(`Invalid comparator: ${c}`);
      this.operator = w[1] !== void 0 ? w[1] : "", this.operator === "=" && (this.operator = ""), w[2] ? this.semver = new u(w[2], this.options.loose) : this.semver = e;
    }
    toString() {
      return this.value;
    }
    test(c) {
      if (o("Comparator.test", c, this.options.loose), this.semver === e || c === e)
        return !0;
      if (typeof c == "string")
        try {
          c = new u(c, this.options);
        } catch {
          return !1;
        }
      return a(c, this.operator, this.semver, this.options);
    }
    intersects(c, p) {
      if (!(c instanceof t))
        throw new TypeError("a Comparator is required");
      return this.operator === "" ? this.value === "" ? !0 : new i(c.value, p).test(this.value) : c.operator === "" ? c.value === "" ? !0 : new i(this.value, p).test(c.semver) : (p = r(p), p.includePrerelease && (this.value === "<0.0.0-0" || c.value === "<0.0.0-0") || !p.includePrerelease && (this.value.startsWith("<0.0.0") || c.value.startsWith("<0.0.0")) ? !1 : !!(this.operator.startsWith(">") && c.operator.startsWith(">") || this.operator.startsWith("<") && c.operator.startsWith("<") || this.semver.version === c.semver.version && this.operator.includes("=") && c.operator.includes("=") || a(this.semver, "<", c.semver, p) && this.operator.startsWith(">") && c.operator.startsWith("<") || a(this.semver, ">", c.semver, p) && this.operator.startsWith("<") && c.operator.startsWith(">")));
    }
  }
  Dn = t;
  const r = ua, { safeRe: n, t: s } = or, a = sc, o = an, u = _e, i = Me();
  return Dn;
}
const m0 = Me(), p0 = (e, t, r) => {
  try {
    t = new m0(t, r);
  } catch {
    return !1;
  }
  return t.test(e);
};
var un = p0;
const y0 = Me(), $0 = (e, t) => new y0(e, t).set.map((r) => r.map((n) => n.value).join(" ").trim().split(" "));
var g0 = $0;
const v0 = _e, _0 = Me(), E0 = (e, t, r) => {
  let n = null, s = null, a = null;
  try {
    a = new _0(t, r);
  } catch {
    return null;
  }
  return e.forEach((o) => {
    a.test(o) && (!n || s.compare(o) === -1) && (n = o, s = new v0(n, r));
  }), n;
};
var w0 = E0;
const S0 = _e, b0 = Me(), P0 = (e, t, r) => {
  let n = null, s = null, a = null;
  try {
    a = new b0(t, r);
  } catch {
    return null;
  }
  return e.forEach((o) => {
    a.test(o) && (!n || s.compare(o) === 1) && (n = o, s = new S0(n, r));
  }), n;
};
var R0 = P0;
const Ln = _e, O0 = Me(), Eo = on, I0 = (e, t) => {
  e = new O0(e, t);
  let r = new Ln("0.0.0");
  if (e.test(r) || (r = new Ln("0.0.0-0"), e.test(r)))
    return r;
  r = null;
  for (let n = 0; n < e.set.length; ++n) {
    const s = e.set[n];
    let a = null;
    s.forEach((o) => {
      const u = new Ln(o.semver.version);
      switch (o.operator) {
        case ">":
          u.prerelease.length === 0 ? u.patch++ : u.prerelease.push(0), u.raw = u.format();
        case "":
        case ">=":
          (!a || Eo(u, a)) && (a = u);
          break;
        case "<":
        case "<=":
          break;
        default:
          throw new Error(`Unexpected operation: ${o.operator}`);
      }
    }), a && (!r || Eo(r, a)) && (r = a);
  }
  return r && e.test(r) ? r : null;
};
var N0 = I0;
const T0 = Me(), j0 = (e, t) => {
  try {
    return new T0(e, t).range || "*";
  } catch {
    return null;
  }
};
var A0 = j0;
const k0 = _e, ac = cn(), { ANY: C0 } = ac, D0 = Me(), L0 = un, wo = on, So = fa, M0 = ha, F0 = da, V0 = (e, t, r, n) => {
  e = new k0(e, n), t = new D0(t, n);
  let s, a, o, u, i;
  switch (r) {
    case ">":
      s = wo, a = M0, o = So, u = ">", i = ">=";
      break;
    case "<":
      s = So, a = F0, o = wo, u = "<", i = "<=";
      break;
    default:
      throw new TypeError('Must provide a hilo val of "<" or ">"');
  }
  if (L0(e, t, n))
    return !1;
  for (let f = 0; f < t.set.length; ++f) {
    const c = t.set[f];
    let p = null, w = null;
    if (c.forEach((y) => {
      y.semver === C0 && (y = new ac(">=0.0.0")), p = p || y, w = w || y, s(y.semver, p.semver, n) ? p = y : o(y.semver, w.semver, n) && (w = y);
    }), p.operator === u || p.operator === i || (!w.operator || w.operator === u) && a(e, w.semver))
      return !1;
    if (w.operator === i && o(e, w.semver))
      return !1;
  }
  return !0;
};
var ma = V0;
const z0 = ma, U0 = (e, t, r) => z0(e, t, ">", r);
var G0 = U0;
const q0 = ma, K0 = (e, t, r) => q0(e, t, "<", r);
var H0 = K0;
const bo = Me(), W0 = (e, t, r) => (e = new bo(e, r), t = new bo(t, r), e.intersects(t, r));
var x0 = W0;
const B0 = un, X0 = Le;
var Y0 = (e, t, r) => {
  const n = [];
  let s = null, a = null;
  const o = e.sort((c, p) => X0(c, p, r));
  for (const c of o)
    B0(c, t, r) ? (a = c, s || (s = c)) : (a && n.push([s, a]), a = null, s = null);
  s && n.push([s, null]);
  const u = [];
  for (const [c, p] of n)
    c === p ? u.push(c) : !p && c === o[0] ? u.push("*") : p ? c === o[0] ? u.push(`<=${p}`) : u.push(`${c} - ${p}`) : u.push(`>=${c}`);
  const i = u.join(" || "), f = typeof t.raw == "string" ? t.raw : String(t);
  return i.length < f.length ? i : t;
};
const Po = Me(), pa = cn(), { ANY: Mn } = pa, Fn = un, ya = Le, J0 = (e, t, r = {}) => {
  if (e === t)
    return !0;
  e = new Po(e, r), t = new Po(t, r);
  let n = !1;
  e:
    for (const s of e.set) {
      for (const a of t.set) {
        const o = Q0(s, a, r);
        if (n = n || o !== null, o)
          continue e;
      }
      if (n)
        return !1;
    }
  return !0;
}, Z0 = [new pa(">=0.0.0-0")], Ro = [new pa(">=0.0.0")], Q0 = (e, t, r) => {
  if (e === t)
    return !0;
  if (e.length === 1 && e[0].semver === Mn) {
    if (t.length === 1 && t[0].semver === Mn)
      return !0;
    r.includePrerelease ? e = Z0 : e = Ro;
  }
  if (t.length === 1 && t[0].semver === Mn) {
    if (r.includePrerelease)
      return !0;
    t = Ro;
  }
  const n = /* @__PURE__ */ new Set();
  let s, a;
  for (const y of e)
    y.operator === ">" || y.operator === ">=" ? s = Oo(s, y, r) : y.operator === "<" || y.operator === "<=" ? a = Io(a, y, r) : n.add(y.semver);
  if (n.size > 1)
    return null;
  let o;
  if (s && a) {
    if (o = ya(s.semver, a.semver, r), o > 0)
      return null;
    if (o === 0 && (s.operator !== ">=" || a.operator !== "<="))
      return null;
  }
  for (const y of n) {
    if (s && !Fn(y, String(s), r) || a && !Fn(y, String(a), r))
      return null;
    for (const b of t)
      if (!Fn(y, String(b), r))
        return !1;
    return !0;
  }
  let u, i, f, c, p = a && !r.includePrerelease && a.semver.prerelease.length ? a.semver : !1, w = s && !r.includePrerelease && s.semver.prerelease.length ? s.semver : !1;
  p && p.prerelease.length === 1 && a.operator === "<" && p.prerelease[0] === 0 && (p = !1);
  for (const y of t) {
    if (c = c || y.operator === ">" || y.operator === ">=", f = f || y.operator === "<" || y.operator === "<=", s) {
      if (w && y.semver.prerelease && y.semver.prerelease.length && y.semver.major === w.major && y.semver.minor === w.minor && y.semver.patch === w.patch && (w = !1), y.operator === ">" || y.operator === ">=") {
        if (u = Oo(s, y, r), u === y && u !== s)
          return !1;
      } else if (s.operator === ">=" && !y.test(s.semver))
        return !1;
    }
    if (a) {
      if (p && y.semver.prerelease && y.semver.prerelease.length && y.semver.major === p.major && y.semver.minor === p.minor && y.semver.patch === p.patch && (p = !1), y.operator === "<" || y.operator === "<=") {
        if (i = Io(a, y, r), i === y && i !== a)
          return !1;
      } else if (a.operator === "<=" && !y.test(a.semver))
        return !1;
    }
    if (!y.operator && (a || s) && o !== 0)
      return !1;
  }
  return !(s && f && !a && o !== 0 || a && c && !s && o !== 0 || w || p);
}, Oo = (e, t, r) => {
  if (!e)
    return t;
  const n = ya(e.semver, t.semver, r);
  return n > 0 ? e : n < 0 || t.operator === ">" && e.operator === ">=" ? t : e;
}, Io = (e, t, r) => {
  if (!e)
    return t;
  const n = ya(e.semver, t.semver, r);
  return n < 0 ? e : n > 0 || t.operator === "<" && e.operator === "<=" ? t : e;
};
var eg = J0;
const Vn = or, No = ar, tg = _e, To = tc, rg = wt, ng = t$, sg = s$, ag = o$, og = c$, ig = f$, cg = m$, ug = $$, lg = _$, fg = Le, dg = b$, hg = O$, mg = la, pg = j$, yg = C$, $g = on, gg = fa, vg = rc, _g = nc, Eg = da, wg = ha, Sg = sc, bg = n0, Pg = f0, Rg = cn(), Og = Me(), Ig = un, Ng = g0, Tg = w0, jg = R0, Ag = N0, kg = A0, Cg = ma, Dg = G0, Lg = H0, Mg = x0, Fg = Y0, Vg = eg;
var zg = {
  parse: rg,
  valid: ng,
  clean: sg,
  inc: ag,
  diff: og,
  major: ig,
  minor: cg,
  patch: ug,
  prerelease: lg,
  compare: fg,
  rcompare: dg,
  compareLoose: hg,
  compareBuild: mg,
  sort: pg,
  rsort: yg,
  gt: $g,
  lt: gg,
  eq: vg,
  neq: _g,
  gte: Eg,
  lte: wg,
  cmp: Sg,
  coerce: bg,
  truncate: Pg,
  Comparator: Rg,
  Range: Og,
  satisfies: Ig,
  toComparators: Ng,
  maxSatisfying: Tg,
  minSatisfying: jg,
  minVersion: Ag,
  validRange: kg,
  outside: Cg,
  gtr: Dg,
  ltr: Lg,
  intersects: Mg,
  simplifyRange: Fg,
  subset: Vg,
  SemVer: tg,
  re: Vn.re,
  src: Vn.src,
  tokens: Vn.t,
  SEMVER_SPEC_VERSION: No.SEMVER_SPEC_VERSION,
  RELEASE_TYPES: No.RELEASE_TYPES,
  compareIdentifiers: To.compareIdentifiers,
  rcompareIdentifiers: To.rcompareIdentifiers
};
const Pt = /* @__PURE__ */ is(zg), Ug = Object.prototype.toString, Gg = "[object Uint8Array]", qg = "[object ArrayBuffer]";
function oc(e, t, r) {
  return e ? e.constructor === t ? !0 : Ug.call(e) === r : !1;
}
function ic(e) {
  return oc(e, Uint8Array, Gg);
}
function Kg(e) {
  return oc(e, ArrayBuffer, qg);
}
function Hg(e) {
  return ic(e) || Kg(e);
}
function Wg(e) {
  if (!ic(e))
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof e}\``);
}
function xg(e) {
  if (!Hg(e))
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof e}\``);
}
function zn(e, t) {
  if (e.length === 0)
    return new Uint8Array(0);
  t ?? (t = e.reduce((s, a) => s + a.length, 0));
  const r = new Uint8Array(t);
  let n = 0;
  for (const s of e)
    Wg(s), r.set(s, n), n += s.length;
  return r;
}
const Sr = {
  utf8: new globalThis.TextDecoder("utf8")
};
function br(e, t = "utf8") {
  return xg(e), Sr[t] ?? (Sr[t] = new globalThis.TextDecoder(t)), Sr[t].decode(e);
}
function Bg(e) {
  if (typeof e != "string")
    throw new TypeError(`Expected \`string\`, got \`${typeof e}\``);
}
const Xg = new globalThis.TextEncoder();
function Un(e) {
  return Bg(e), Xg.encode(e);
}
Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, "0"));
const jo = "aes-256-cbc", cc = /* @__PURE__ */ new Set([
  "aes-256-cbc",
  "aes-256-gcm",
  "aes-256-ctr"
]), Yg = (e) => typeof e == "string" && cc.has(e), Ke = () => /* @__PURE__ */ Object.create(null), Ao = (e) => e !== void 0, Gn = (e, t) => {
  const r = /* @__PURE__ */ new Set([
    "undefined",
    "symbol",
    "function"
  ]), n = typeof t;
  if (r.has(n))
    throw new TypeError(`Setting a value of type \`${n}\` for key \`${e}\` is not allowed as it's not supported by JSON`);
}, rt = "__internal__", qn = `${rt}.migrations.version`;
var st, at, mt, Pe, Te, pt, yt, Ct, Ve, Fr, uc, Vr, lc, zr, fc, Ur, dc, Gr, hc, qr, mc, Kr, pc, Hr, yc;
class Jg {
  constructor(t = {}) {
    le(this, Fr);
    le(this, Vr);
    le(this, zr);
    le(this, Ur);
    le(this, Gr);
    le(this, qr);
    le(this, Kr);
    le(this, Hr);
    Kt(this, "path");
    Kt(this, "events");
    le(this, st, void 0);
    le(this, at, void 0);
    le(this, mt, void 0);
    le(this, Pe, void 0);
    le(this, Te, {});
    le(this, pt, !1);
    le(this, yt, void 0);
    le(this, Ct, void 0);
    le(this, Ve, void 0);
    Kt(this, "_deserialize", (t) => JSON.parse(t));
    Kt(this, "_serialize", (t) => JSON.stringify(t, void 0, "	"));
    const r = Ge(this, Fr, uc).call(this, t);
    be(this, Pe, r), Ge(this, Vr, lc).call(this, r), Ge(this, Ur, dc).call(this, r), Ge(this, Gr, hc).call(this, r), this.events = new EventTarget(), be(this, at, r.encryptionKey), be(this, mt, r.encryptionAlgorithm ?? jo), this.path = Ge(this, qr, mc).call(this, r), Ge(this, Kr, pc).call(this, r), r.watch && this._watch();
  }
  get(t, r) {
    if (x(this, Pe).accessPropertiesByDotNotation)
      return this._get(t, r);
    const { store: n } = this;
    return t in n ? n[t] : r;
  }
  set(t, r) {
    if (typeof t != "string" && typeof t != "object")
      throw new TypeError(`Expected \`key\` to be of type \`string\` or \`object\`, got ${typeof t}`);
    if (typeof t != "object" && r === void 0)
      throw new TypeError("Use `delete()` to clear values");
    if (this._containsReservedKey(t))
      throw new TypeError(`Please don't use the ${rt} key, as it's used to manage this module internal operations.`);
    const { store: n } = this, s = (a, o) => {
      if (Gn(a, o), x(this, Pe).accessPropertiesByDotNotation)
        lr(n, a, o);
      else {
        if (a === "__proto__" || a === "constructor" || a === "prototype")
          return;
        n[a] = o;
      }
    };
    if (typeof t == "object") {
      const a = t;
      for (const [o, u] of Object.entries(a))
        s(o, u);
    } else
      s(t, r);
    this.store = n;
  }
  has(t) {
    return x(this, Pe).accessPropertiesByDotNotation ? Rn(this.store, t) : t in this.store;
  }
  appendToArray(t, r) {
    Gn(t, r);
    const n = x(this, Pe).accessPropertiesByDotNotation ? this._get(t, []) : t in this.store ? this.store[t] : [];
    if (!Array.isArray(n))
      throw new TypeError(`The key \`${t}\` is already set to a non-array value`);
    this.set(t, [...n, r]);
  }
  /**
      Reset items to their default values, as defined by the `defaults` or `schema` option.
  
      @see `clear()` to reset all items.
  
      @param keys - The keys of the items to reset.
      */
  reset(...t) {
    for (const r of t)
      Ao(x(this, Te)[r]) && this.set(r, x(this, Te)[r]);
  }
  delete(t) {
    const { store: r } = this;
    x(this, Pe).accessPropertiesByDotNotation ? Xc(r, t) : delete r[t], this.store = r;
  }
  /**
      Delete all items.
  
      This resets known items to their default values, if defined by the `defaults` or `schema` option.
      */
  clear() {
    const t = Ke();
    for (const r of Object.keys(x(this, Te)))
      Ao(x(this, Te)[r]) && (Gn(r, x(this, Te)[r]), x(this, Pe).accessPropertiesByDotNotation ? lr(t, r, x(this, Te)[r]) : t[r] = x(this, Te)[r]);
    this.store = t;
  }
  onDidChange(t, r) {
    if (typeof t != "string")
      throw new TypeError(`Expected \`key\` to be of type \`string\`, got ${typeof t}`);
    if (typeof r != "function")
      throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof r}`);
    return this._handleValueChange(() => this.get(t), r);
  }
  /**
      Watches the whole config object, calling `callback` on any changes.
  
      @param callback - A callback function that is called on any changes. When a `key` is first set `oldValue` will be `undefined`, and when a key is deleted `newValue` will be `undefined`.
      @returns A function, that when called, will unsubscribe.
      */
  onDidAnyChange(t) {
    if (typeof t != "function")
      throw new TypeError(`Expected \`callback\` to be of type \`function\`, got ${typeof t}`);
    return this._handleStoreChange(t);
  }
  get size() {
    return Object.keys(this.store).filter((r) => !this._isReservedKeyPath(r)).length;
  }
  /**
      Get all the config as an object or replace the current config with an object.
  
      @example
      ```
      console.log(config.store);
      //=> {name: 'John', age: 30}
      ```
  
      @example
      ```
      config.store = {
          hello: 'world'
      };
      ```
      */
  get store() {
    var t;
    try {
      const r = B.readFileSync(this.path, x(this, at) ? null : "utf8"), n = this._decryptData(r);
      return ((a) => {
        const o = this._deserialize(a);
        return x(this, pt) || this._validate(o), Object.assign(Ke(), o);
      })(n);
    } catch (r) {
      if ((r == null ? void 0 : r.code) === "ENOENT")
        return this._ensureDirectory(), Ke();
      if (x(this, Pe).clearInvalidConfig) {
        const n = r;
        if (n.name === "SyntaxError" || (t = n.message) != null && t.startsWith("Config schema violation:") || n.message === "Failed to decrypt config data.")
          return Ke();
      }
      throw r;
    }
  }
  set store(t) {
    if (this._ensureDirectory(), !Rn(t, rt))
      try {
        const r = B.readFileSync(this.path, x(this, at) ? null : "utf8"), n = this._decryptData(r), s = this._deserialize(n);
        Rn(s, rt) && lr(t, rt, Na(s, rt));
      } catch {
      }
    x(this, pt) || this._validate(t), this._write(t), this.events.dispatchEvent(new Event("change"));
  }
  *[Symbol.iterator]() {
    for (const [t, r] of Object.entries(this.store))
      this._isReservedKeyPath(t) || (yield [t, r]);
  }
  /**
  Close the file watcher if one exists. This is useful in tests to prevent the process from hanging.
  */
  _closeWatcher() {
    x(this, yt) && (x(this, yt).close(), be(this, yt, void 0)), x(this, Ct) && (B.unwatchFile(this.path), be(this, Ct, !1)), be(this, Ve, void 0);
  }
  _decryptData(t) {
    const r = x(this, at);
    if (!r)
      return typeof t == "string" ? t : br(t);
    const n = x(this, mt), s = n === "aes-256-gcm" ? 16 : 0, a = ":".codePointAt(0), o = typeof t == "string" ? t.codePointAt(16) : t[16];
    if (!(a !== void 0 && o === a)) {
      if (n === "aes-256-cbc")
        return typeof t == "string" ? t : br(t);
      throw new Error("Failed to decrypt config data.");
    }
    const i = (y) => {
      if (s === 0)
        return { ciphertext: y };
      const b = y.length - s;
      if (b < 0)
        throw new Error("Invalid authentication tag length.");
      return {
        ciphertext: y.slice(0, b),
        authenticationTag: y.slice(b)
      };
    }, f = t.slice(0, 16), c = t.slice(17), p = typeof c == "string" ? Un(c) : c, w = (y) => {
      const { ciphertext: b, authenticationTag: _ } = i(p), d = Ht.pbkdf2Sync(r, y, 1e4, 32, "sha512"), m = Ht.createDecipheriv(n, d, f);
      return _ && m.setAuthTag(_), br(zn([m.update(b), m.final()]));
    };
    try {
      return w(f);
    } catch {
      try {
        return w(f.toString());
      } catch {
      }
    }
    if (n === "aes-256-cbc")
      return typeof t == "string" ? t : br(t);
    throw new Error("Failed to decrypt config data.");
  }
  _handleStoreChange(t) {
    let r = this.store;
    const n = () => {
      const s = r, a = this.store;
      Ea(a, s) || (r = a, t.call(this, a, s));
    };
    return this.events.addEventListener("change", n), () => {
      this.events.removeEventListener("change", n);
    };
  }
  _handleValueChange(t, r) {
    let n = t();
    const s = () => {
      const a = n, o = t();
      Ea(o, a) || (n = o, r.call(this, o, a));
    };
    return this.events.addEventListener("change", s), () => {
      this.events.removeEventListener("change", s);
    };
  }
  _validate(t) {
    if (!x(this, st) || x(this, st).call(this, t) || !x(this, st).errors)
      return;
    const n = x(this, st).errors.map(({ instancePath: s, message: a = "" }) => `\`${s.slice(1)}\` ${a}`);
    throw new Error("Config schema violation: " + n.join("; "));
  }
  _ensureDirectory() {
    B.mkdirSync(H.dirname(this.path), { recursive: !0 });
  }
  _write(t) {
    let r = this._serialize(t);
    const n = x(this, at);
    if (n) {
      const s = Ht.randomBytes(16), a = Ht.pbkdf2Sync(n, s, 1e4, 32, "sha512"), o = Ht.createCipheriv(x(this, mt), a, s), u = zn([o.update(Un(r)), o.final()]), i = [s, Un(":"), u];
      x(this, mt) === "aes-256-gcm" && i.push(o.getAuthTag()), r = zn(i);
    }
    if (se.env.SNAP)
      B.writeFileSync(this.path, r, { mode: x(this, Pe).configFileMode });
    else
      try {
        Bo(this.path, r, { mode: x(this, Pe).configFileMode });
      } catch (s) {
        if ((s == null ? void 0 : s.code) === "EXDEV") {
          B.writeFileSync(this.path, r, { mode: x(this, Pe).configFileMode });
          return;
        }
        throw s;
      }
  }
  _watch() {
    if (this._ensureDirectory(), B.existsSync(this.path) || this._write(Ke()), se.platform === "win32" || se.platform === "darwin") {
      x(this, Ve) ?? be(this, Ve, lo(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 100 }));
      const t = H.dirname(this.path), r = H.basename(this.path);
      be(this, yt, B.watch(t, { persistent: !1, encoding: "utf8" }, (n, s) => {
        s && s !== r || typeof x(this, Ve) == "function" && x(this, Ve).call(this);
      }));
    } else
      x(this, Ve) ?? be(this, Ve, lo(() => {
        this.events.dispatchEvent(new Event("change"));
      }, { wait: 1e3 })), B.watchFile(this.path, { persistent: !1 }, (t, r) => {
        typeof x(this, Ve) == "function" && x(this, Ve).call(this);
      }), be(this, Ct, !0);
  }
  _migrate(t, r, n) {
    let s = this._get(qn, "0.0.0");
    const a = Object.keys(t).filter((u) => this._shouldPerformMigration(u, s, r));
    let o = structuredClone(this.store);
    for (const u of a)
      try {
        n && n(this, {
          fromVersion: s,
          toVersion: u,
          finalVersion: r,
          versions: a
        });
        const i = t[u];
        i == null || i(this), this._set(qn, u), s = u, o = structuredClone(this.store);
      } catch (i) {
        this.store = o;
        const f = i instanceof Error ? i.message : String(i);
        throw new Error(`Something went wrong during the migration! Changes applied to the store until this failed migration will be restored. ${f}`);
      }
    (this._isVersionInRangeFormat(s) || !Pt.eq(s, r)) && this._set(qn, r);
  }
  _containsReservedKey(t) {
    return typeof t == "string" ? this._isReservedKeyPath(t) : !t || typeof t != "object" ? !1 : this._objectContainsReservedKey(t);
  }
  _objectContainsReservedKey(t) {
    if (!t || typeof t != "object")
      return !1;
    for (const [r, n] of Object.entries(t))
      if (this._isReservedKeyPath(r) || this._objectContainsReservedKey(n))
        return !0;
    return !1;
  }
  _isReservedKeyPath(t) {
    return t === rt || t.startsWith(`${rt}.`);
  }
  _isVersionInRangeFormat(t) {
    return Pt.clean(t) === null;
  }
  _shouldPerformMigration(t, r, n) {
    return this._isVersionInRangeFormat(t) ? r !== "0.0.0" && Pt.satisfies(r, t) ? !1 : Pt.satisfies(n, t) : !(Pt.lte(t, r) || Pt.gt(t, n));
  }
  _get(t, r) {
    return Na(this.store, t, r);
  }
  _set(t, r) {
    const { store: n } = this;
    lr(n, t, r), this.store = n;
  }
}
st = new WeakMap(), at = new WeakMap(), mt = new WeakMap(), Pe = new WeakMap(), Te = new WeakMap(), pt = new WeakMap(), yt = new WeakMap(), Ct = new WeakMap(), Ve = new WeakMap(), Fr = new WeakSet(), uc = function(t) {
  const r = {
    configName: "config",
    fileExtension: "json",
    projectSuffix: "nodejs",
    clearInvalidConfig: !1,
    accessPropertiesByDotNotation: !0,
    configFileMode: 438,
    ...t
  };
  if (r.encryptionAlgorithm ?? (r.encryptionAlgorithm = jo), !Yg(r.encryptionAlgorithm))
    throw new TypeError(`The \`encryptionAlgorithm\` option must be one of: ${[...cc].join(", ")}`);
  if (!r.cwd) {
    if (!r.projectName)
      throw new Error("Please specify the `projectName` option.");
    r.cwd = Qc(r.projectName, { suffix: r.projectSuffix }).config;
  }
  return typeof r.fileExtension == "string" && (r.fileExtension = r.fileExtension.replace(/^\.+/, "")), r;
}, Vr = new WeakSet(), lc = function(t) {
  if (!(t.schema ?? t.ajvOptions ?? t.rootSchema))
    return;
  if (t.schema && typeof t.schema != "object")
    throw new TypeError("The `schema` option must be an object.");
  const r = Ty.default, n = new py.Ajv2020({
    allErrors: !0,
    useDefaults: !0,
    ...t.ajvOptions
  });
  r(n);
  const s = {
    ...t.rootSchema,
    type: "object",
    properties: t.schema
  };
  be(this, st, n.compile(s)), Ge(this, zr, fc).call(this, t.schema);
}, zr = new WeakSet(), fc = function(t) {
  const r = Object.entries(t ?? {});
  for (const [n, s] of r) {
    if (!s || typeof s != "object" || !Object.hasOwn(s, "default"))
      continue;
    const { default: a } = s;
    a !== void 0 && (x(this, Te)[n] = a);
  }
}, Ur = new WeakSet(), dc = function(t) {
  t.defaults && Object.assign(x(this, Te), t.defaults);
}, Gr = new WeakSet(), hc = function(t) {
  t.serialize && (this._serialize = t.serialize), t.deserialize && (this._deserialize = t.deserialize);
}, qr = new WeakSet(), mc = function(t) {
  const r = typeof t.fileExtension == "string" ? t.fileExtension : void 0, n = r ? `.${r}` : "";
  return H.resolve(t.cwd, `${t.configName ?? "config"}${n}`);
}, Kr = new WeakSet(), pc = function(t) {
  if (t.migrations) {
    Ge(this, Hr, yc).call(this, t), this._validate(this.store);
    return;
  }
  const r = this.store, n = Object.assign(Ke(), t.defaults ?? {}, r);
  this._validate(n);
  try {
    wa.deepEqual(r, n);
  } catch {
    this.store = n;
  }
}, Hr = new WeakSet(), yc = function(t) {
  const { migrations: r, projectVersion: n } = t;
  if (r) {
    if (!n)
      throw new Error("Please specify the `projectVersion` option.");
    be(this, pt, !0);
    try {
      const s = this.store, a = Object.assign(Ke(), t.defaults ?? {}, s);
      try {
        wa.deepEqual(s, a);
      } catch {
        this._write(a);
      }
      this._migrate(r, n, t.beforeEachMigration);
    } finally {
      be(this, pt, !1);
    }
  }
};
const { app: jr, ipcMain: ns, shell: Zg } = ss;
let ko = !1;
const Co = () => {
  if (!ns || !jr)
    throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
  const e = {
    defaultCwd: jr.getPath("userData"),
    appVersion: jr.getVersion()
  };
  return ko || (ns.on("electron-store-get-data", (t) => {
    t.returnValue = e;
  }), ko = !0), e;
};
class Qg extends Jg {
  constructor(t) {
    let r, n;
    if (se.type === "renderer") {
      const s = ss.ipcRenderer.sendSync("electron-store-get-data");
      if (!s)
        throw new Error("Electron Store: You need to call `.initRenderer()` from the main process.");
      ({ defaultCwd: r, appVersion: n } = s);
    } else
      ns && jr && ({ defaultCwd: r, appVersion: n } = Co());
    t = {
      name: "config",
      ...t
    }, t.projectVersion || (t.projectVersion = n), t.cwd ? t.cwd = H.isAbsolute(t.cwd) ? t.cwd : H.join(r, t.cwd) : t.cwd = r, t.configName = t.name, delete t.name, super(t);
  }
  static initRenderer() {
    Co();
  }
  async openInEditor() {
    const t = await Zg.openPath(this.path);
    if (t)
      throw new Error(t);
  }
}
const fe = {
  apiBaseUrl: "http://180.184.76.232:19090",
  localEpisodeVideoRoot: "",
  closeFailedTaskPages: "false",
  runDataDir: ".drama-runs",
  logRetentionDays: "3",
  workerEmptyClaimDelaySeconds: "5",
  workerSlowEmptyClaimThreshold: "30",
  workerSlowEmptyClaimDelaySeconds: "30",
  videoAccountSyncIntervalSeconds: "600",
  idlePageRefreshIntervalSeconds: "10800",
  idlePageRefreshTimeoutSeconds: "60",
  idlePageRefreshJitterSeconds: "300",
  basicInfoStepTimeoutSeconds: "600",
  remoteFileDownloadTimeoutSeconds: "120",
  episodeUploadWaitTimeoutSeconds: "7200",
  episodeUploadFailedRetryAttempts: "3",
  feishuBotWebhookUrl: ""
};
let Ie = null, et = null, Kn = null;
function Pr() {
  return {
    running: Ie !== null,
    pid: Ie ? process.pid : null
  };
}
function $a() {
  return Kn || (Kn = new Qg({
    name: "wechat-video-config",
    defaults: {
      config: fe
    }
  })), Kn;
}
function Do() {
  return $a().path;
}
function $c() {
  return gc($a().get("config"));
}
function ev(e) {
  $a().set("config", e);
}
async function Lo(e, t) {
  const r = as.fromWebContents(e.sender), n = r ? await _a.showOpenDialog(r, t) : await _a.showOpenDialog(t);
  return n.canceled ? null : n.filePaths[0] ?? null;
}
function Mo(e, t) {
  const r = e == null ? void 0 : e.trim();
  return r ? H.isAbsolute(r) ? r : H.join(process.env.APP_ROOT, r) : t;
}
function gc(e) {
  return {
    apiBaseUrl: e.apiBaseUrl ?? fe.apiBaseUrl,
    localEpisodeVideoRoot: e.localEpisodeVideoRoot ?? fe.localEpisodeVideoRoot,
    closeFailedTaskPages: e.closeFailedTaskPages ?? fe.closeFailedTaskPages,
    runDataDir: e.runDataDir ?? fe.runDataDir,
    logRetentionDays: e.logRetentionDays ?? fe.logRetentionDays,
    workerEmptyClaimDelaySeconds: e.workerEmptyClaimDelaySeconds ?? fe.workerEmptyClaimDelaySeconds,
    workerSlowEmptyClaimThreshold: e.workerSlowEmptyClaimThreshold ?? fe.workerSlowEmptyClaimThreshold,
    workerSlowEmptyClaimDelaySeconds: e.workerSlowEmptyClaimDelaySeconds ?? fe.workerSlowEmptyClaimDelaySeconds,
    videoAccountSyncIntervalSeconds: e.videoAccountSyncIntervalSeconds ?? fe.videoAccountSyncIntervalSeconds,
    idlePageRefreshIntervalSeconds: e.idlePageRefreshIntervalSeconds ?? fe.idlePageRefreshIntervalSeconds,
    idlePageRefreshTimeoutSeconds: e.idlePageRefreshTimeoutSeconds ?? fe.idlePageRefreshTimeoutSeconds,
    idlePageRefreshJitterSeconds: e.idlePageRefreshJitterSeconds ?? fe.idlePageRefreshJitterSeconds,
    basicInfoStepTimeoutSeconds: e.basicInfoStepTimeoutSeconds ?? fe.basicInfoStepTimeoutSeconds,
    remoteFileDownloadTimeoutSeconds: e.remoteFileDownloadTimeoutSeconds ?? fe.remoteFileDownloadTimeoutSeconds,
    episodeUploadWaitTimeoutSeconds: e.episodeUploadWaitTimeoutSeconds ?? fe.episodeUploadWaitTimeoutSeconds,
    episodeUploadFailedRetryAttempts: e.episodeUploadFailedRetryAttempts ?? fe.episodeUploadFailedRetryAttempts,
    feishuBotWebhookUrl: e.feishuBotWebhookUrl ?? fe.feishuBotWebhookUrl
  };
}
function tv() {
  return process.env.PLAYWRIGHT_BROWSERS_PATH ? process.env.PLAYWRIGHT_BROWSERS_PATH : xe.isPackaged ? H.join(process.resourcesPath, "playwright-browsers") : H.join(process.env.APP_ROOT, ".cache", "playwright-browsers");
}
async function rv() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = tv();
  const e = "@drama/wechat-video-automation/runtime", { startWechatVideoRuntime: t } = await import(
    /* @vite-ignore */
    e
  );
  return t({
    settings: $c()
  });
}
function nv() {
  ct.handle("wechat-video:config:get", () => ({
    config: $c(),
    path: Do(),
    restartRequired: !1
  })), ct.handle("wechat-video:config:save", async (e, t) => {
    const r = gc(t);
    return ev(r), {
      config: r,
      path: Do(),
      restartRequired: Ie !== null || et !== null
    };
  }), ct.handle("wechat-video:config:select-local-episode-video-root", async (e, t) => Lo(e, {
    title: "选择剧集视频根目录",
    defaultPath: Mo(t, xe.getPath("videos")),
    properties: ["openDirectory", "createDirectory"]
  })), ct.handle("wechat-video:config:select-run-data-dir", async (e, t) => Lo(e, {
    title: "选择运行数据目录",
    defaultPath: Mo(t, xe.getPath("documents")),
    properties: ["openDirectory", "createDirectory"]
  })), ct.handle("wechat-video:service:status", () => Pr()), ct.handle("wechat-video:service:start", async () => {
    if (Ie)
      return Pr();
    et || (et = rv());
    try {
      Ie = await et;
    } finally {
      et = null;
    }
    return Pr();
  }), ct.handle("wechat-video:service:stop", async () => (et && (Ie = await et, et = null), Ie && (await Ie.stop(), Ie = null), Pr()));
}
function sv() {
  Ie == null || Ie.stop(), Ie = null;
}
const vc = H.dirname(Ac(import.meta.url));
process.env.APP_ROOT = H.join(vc, "..");
const Mr = process.env.VITE_DEV_SERVER_URL, Sv = H.join(process.env.APP_ROOT, "dist-electron"), _c = H.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Mr ? H.join(process.env.APP_ROOT, "public") : _c;
let Ot;
function Ec() {
  return H.join(process.env.VITE_PUBLIC, "icon.png");
}
function wc() {
  const e = Oc.createFromPath(Ec()), t = Wc({
    defaultWidth: 1280,
    defaultHeight: 860
  });
  Ot = new as({
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    minWidth: 1024,
    minHeight: 720,
    icon: e,
    webPreferences: {
      preload: H.join(vc, "preload.mjs")
    }
  }), t.manage(Ot), Ot.setMenu(null), Mr ? Ot.loadURL(Mr) : Ot.loadFile(H.join(_c, "index.html"));
}
xe.on("window-all-closed", () => {
  process.platform !== "darwin" && (xe.quit(), Ot = null);
});
xe.on("before-quit", () => {
  sv();
});
xe.on("activate", () => {
  as.getAllWindows().length === 0 && wc();
});
xe.whenReady().then(() => {
  var e;
  Rc.setApplicationMenu(null), nv(), process.platform === "darwin" && Mr && ((e = xe.dock) == null || e.setIcon(Ec())), wc();
});
export {
  Sv as MAIN_DIST,
  _c as RENDERER_DIST,
  Mr as VITE_DEV_SERVER_URL
};
