# ONNX Export Notes

## DistilBERT torch.export Limitation (PyTorch 2.8)

**Issue**: Modern ONNX exporter (`torch.onnx.export` with `dynamo=True`) fails on DistilBERT models due to unsupported `scaled_dot_product_attention` operation in the attention mechanism.

**Error**:
```
torch._dynamo.exc.Unsupported: torch.nn.functional.scaled_dot_product_attention
(in transformers/models/distilbert/modeling_distilbert.py, line 392)
```

**Affected environments**: Both CPU and GPU (tested with RTX 4090, CUDA 13.0)

**Workaround**: `export_onnx.py` automatically falls back to legacy exporter with `dynamic_axes` instead of `dynamic_shapes`. The fallback produces functionally equivalent ONNX models (opset 14) compatible with Triton Inference Server's ORT backend.

**Validation**:
- ✅ CPU smoke test: Legacy exporter successful
- ✅ GPU smoke test: Legacy exporter successful (run 18611015633)
- ✅ Triton deployment: Working on Calypso with CUDAExecutionProvider

**Future**: Monitor PyTorch/transformers releases for torch.export support improvements. The fallback mechanism should remain until DistilBERT attention is fully supported by torch.export.

**Related**: Issue #160 (NER pipeline modernization)
