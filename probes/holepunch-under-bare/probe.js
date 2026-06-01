// Does the Holepunch stack load — including its native addons — under Bare in
// the distroless-cc image, and at which versions? Re-run via ./run.sh when the
// deps or base image change, and compare run.log.
function ver (p) { try { return require(p + '/package.json').version } catch (e) { return '?' } }
function ok (name, extra = {}) { console.log(JSON.stringify({ probe: name, version: ver(name), status: 'ok', ...extra })) }
function fail (name, e) { console.log(JSON.stringify({ probe: name, version: ver(name), status: 'FAIL', err: String(e.message || e).slice(0, 200) })) }

try { const sodium = require('sodium-native'); const b = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES); ok('sodium-native', { pkBytes: b.length }) } catch (e) { fail('sodium-native', e) }
try { const UDX = require('udx-native'); const u = new UDX(); ok('udx-native', { hasSocket: typeof u.createSocket === 'function' }) } catch (e) { fail('udx-native', e) }
try { const DHT = require('hyperdht'); ok('hyperdht', { hasBootstrapper: typeof DHT.bootstrapper === 'function' }) } catch (e) { fail('hyperdht', e) }
try { const Hyperswarm = require('hyperswarm'); const s = new Hyperswarm(); ok('hyperswarm', { keyBytes: s.keyPair.publicKey.length }); s.destroy() } catch (e) { fail('hyperswarm', e) }
try { const Signal = require('bare-signals'); ok('bare-signals', { ctor: typeof Signal }) } catch (e) { fail('bare-signals', e) }
