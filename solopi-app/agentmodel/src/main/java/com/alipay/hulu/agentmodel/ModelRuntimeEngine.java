package com.alipay.hulu.agentmodel;

import android.os.Debug;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.pytorch.executorch.EValue;
import org.pytorch.executorch.Module;
import org.pytorch.executorch.Tensor;

import java.io.File;

final class ModelRuntimeEngine {
    private Module module;
    private String modelId;
    private String version;
    private long lastLoadMs;

    synchronized JSONObject load(File modelFile, String requestedModelId, String requestedVersion)
            throws JSONException {
        if (requestedModelId.equals(modelId) && requestedVersion.equals(version) && module != null) {
            return loadReceipt(false);
        }
        long started = SystemClock.elapsedRealtimeNanos();
        Module candidate = Module.load(modelFile.getAbsolutePath(), Module.LOAD_MODE_MMAP);
        try {
            candidate.loadMethod("forward");
        } catch (RuntimeException error) {
            candidate.destroy();
            throw error;
        }
        long duration = (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000L;
        Module previous = module;
        module = candidate;
        modelId = requestedModelId;
        version = requestedVersion;
        lastLoadMs = duration;
        if (previous != null) {
            previous.destroy();
        }
        return loadReceipt(true);
    }

    private JSONObject loadReceipt(boolean loaded) throws JSONException {
        return new JSONObject()
                .put("loaded", loaded)
                .put("modelId", modelId)
                .put("version", version)
                .put("runtime", "executorch")
                .put("runtimeVersion", "1.4.0")
                .put("backend", "xnnpack")
                .put("loadMs", lastLoadMs);
    }

    synchronized JSONObject infer(JSONArray rawInputs) throws JSONException {
        if (module == null) {
            throw new IllegalStateException("No model is active in the runtime");
        }
        if (rawInputs.length() == 0 || rawInputs.length() > 16) {
            throw new IllegalArgumentException("inputs must contain 1 to 16 tensors");
        }
        EValue[] inputs = new EValue[rawInputs.length()];
        for (int index = 0; index < rawInputs.length(); index++) {
            JSONArray rawTensor = rawInputs.getJSONArray(index);
            if (rawTensor.length() == 0 || rawTensor.length() > 1_000_000) {
                throw new IllegalArgumentException("tensor length is outside the supported range");
            }
            float[] data = new float[rawTensor.length()];
            for (int item = 0; item < rawTensor.length(); item++) {
                double value = rawTensor.getDouble(item);
                if (Double.isNaN(value) || Double.isInfinite(value)) {
                    throw new IllegalArgumentException("tensor value must be finite");
                }
                data[item] = (float) value;
            }
            inputs[index] = EValue.from(Tensor.fromBlob(data, new long[]{data.length}));
        }
        long started = SystemClock.elapsedRealtimeNanos();
        EValue[] result = module.forward(inputs);
        long inferenceMicros = (SystemClock.elapsedRealtimeNanos() - started) / 1_000L;
        if (result.length != 1 || !result[0].isTensor()) {
            throw new IllegalStateException("Policy model must return one tensor");
        }
        float[] values = result[0].toTensor().getDataAsFloatArray();
        JSONArray outputs = new JSONArray();
        for (float value : values) {
            outputs.put(value);
        }
        return new JSONObject()
                .put("success", true)
                .put("runtime", "executorch")
                .put("runtimeVersion", "1.4.0")
                .put("modelId", modelId)
                .put("version", version)
                .put("backend", "xnnpack")
                .put("loadMs", lastLoadMs)
                .put("inferenceMs", inferenceMicros / 1000.0d)
                .put("memoryMb", Debug.getPss() / 1024.0d)
                .put("outputs", outputs);
    }
}
