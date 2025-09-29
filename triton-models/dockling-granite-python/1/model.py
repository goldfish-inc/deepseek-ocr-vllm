import io
import json
import numpy as np
import triton_python_backend_utils as pb_utils


class TritonPythonModel:
    def initialize(self, args):
        # Called once at model load time.
        # Example: self.model_dir = args.get("model_repository", "")
        # Load your Docling/Granite pipeline here if available.
        self.ready = True
        # Try to import optional PDF extractors (best-effort)
        self._pdf_backend = None
        try:
            import pypdf  # type: ignore
            self._pdf_backend = "pypdf"
        except Exception:
            try:
                # pdfminer.six
                import pdfminer  # type: ignore
                self._pdf_backend = "pdfminer"
            except Exception:
                self._pdf_backend = None

    def _extract_text_from_pdf(self, pdf_bytes: bytes) -> str:
        if not pdf_bytes:
            return ""
        # pypdf backend
        if self._pdf_backend == "pypdf":
            try:
                import pypdf  # type: ignore
                reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
                parts = []
                for page in reader.pages:
                    try:
                        parts.append(page.extract_text() or "")
                    except Exception:
                        continue
                return "\n".join([p for p in parts if p])
            except Exception:
                pass
        # pdfminer backend
        if self._pdf_backend == "pdfminer":
            try:
                from pdfminer.high_level import extract_text  # type: ignore
                return extract_text(io.BytesIO(pdf_bytes)) or ""
            except Exception:
                pass
        # Fallback: no extraction available
        return ""

    def _get_bytes(self, request, name):
        t = pb_utils.get_input_tensor_by_name(request, name)
        if t is None:
            return None
        arr = t.as_numpy()
        if arr is None:
            return None
        # Expect shape [1,1] for BYTES
        try:
            return arr.astype(object)[0][0]
        except Exception:
            # fallback: best-effort first element
            try:
                return arr.flat[0]
            except Exception:
                return None

    def execute(self, requests):
        responses = []
        for request in requests:
            pdf_bytes = self._get_bytes(request, "pdf_data")
            prompt_bytes = self._get_bytes(request, "prompt")
            text_bytes = self._get_bytes(request, "text")  # optional alias

            prompt = None
            text = None
            try:
                if prompt_bytes is not None:
                    prompt = prompt_bytes.decode("utf-8", errors="ignore")
                if text_bytes is not None:
                    text = text_bytes.decode("utf-8", errors="ignore")
            except Exception:
                pass

            # Skeleton pipeline: extract text from PDF (if provided),
            # then apply a very simple prompt-driven summarization stub.
            extracted = self._extract_text_from_pdf(pdf_bytes) if pdf_bytes is not None else (text or "")
            preview = (extracted or "").strip()
            preview = preview[:2000]  # limit size

            # Compose a deterministic response payload for downstream consumers.
            # Replace this with real Docling/Granite inference.
            response_text = preview
            if prompt:
                # naive template application
                response_text = f"Prompt: {prompt}\n\nExcerpt:\n{preview}"

            result = {
                "ok": True,
                "model": "docling_granite_python",
                "received": {
                    "pdf_data": pdf_bytes is not None,
                    "prompt": prompt is not None,
                    "text": text is not None,
                },
                "document": {
                    "chars": int(len(extracted)) if extracted is not None else 0,
                    "preview": preview,
                },
                "output": {
                    "text": response_text,
                    "format": "text/plain",
                },
                "message": "Replace with real Docling/Granite inference when dependencies are available.",
            }

            payload = json.dumps(result).encode("utf-8")
            out_tensor = pb_utils.Tensor("response", np.array([[payload]], dtype=object))
            responses.append(pb_utils.InferenceResponse(output_tensors=[out_tensor]))
        return responses

    def finalize(self):
        # Called at model unload.
        self.ready = False
