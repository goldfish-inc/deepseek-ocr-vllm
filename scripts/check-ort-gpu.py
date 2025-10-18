#!/usr/bin/env python3
import sys
try:
    import onnxruntime as ort
    prov = ort.get_available_providers()
    print('ORT providers:', prov)
    if 'CUDAExecutionProvider' in prov:
        print('✅ CUDAExecutionProvider available')
        sys.exit(0)
    else:
        print('❌ CUDAExecutionProvider missing')
        sys.exit(1)
except Exception as e:
    print('❌ ORT import/providers check failed:', e)
    sys.exit(2)
