// tests/onnx-environment.js
const { TestEnvironment } = require('jest-environment-node');

/**
 * Jest menjalankan test di realm JavaScript tersendiri, sehingga Float32Array
 * yang dibuat di dalam test bukan konstruktor yang sama dengan Float32Array
 * milik proses utama.
 *
 * Modul native seperti onnxruntime-node memeriksa dengan instanceof terhadap
 * konstruktor realm utama, jadi tensor yang dibuat di test akan ditolak dengan
 * pesan "A float32 tensor's data must be type of Float32Array".
 *
 * Environment ini mengembalikan tipe-tipe tersebut ke konstruktor realm utama.
 */
class OnnxEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();

    this.global.ArrayBuffer = ArrayBuffer;
    this.global.SharedArrayBuffer = SharedArrayBuffer;
    this.global.Float32Array = Float32Array;
    this.global.Float64Array = Float64Array;
    this.global.Int8Array = Int8Array;
    this.global.Uint8Array = Uint8Array;
    this.global.Int32Array = Int32Array;
    this.global.Uint32Array = Uint32Array;
    this.global.BigInt64Array = BigInt64Array;
    this.global.Buffer = Buffer;
  }
}

module.exports = OnnxEnvironment;
