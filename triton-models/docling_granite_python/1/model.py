import io
import json
import numpy as np
import triton_python_backend_utils as pb_utils


class TritonPythonModel:
    def initialize(self, args):
        self.ready = True
        self._converter = None
        try:
            from docling.document_converter import DocumentConverter
            self._converter = DocumentConverter()
        except Exception as e:
            print(f"[WARN] Docling not available, falling back to basic extraction: {e}")
            self._converter = None

    def _extract_with_docling(self, pdf_bytes: bytes) -> dict:
        """Extract PDF content using Docling with table/formula support."""
        if not pdf_bytes or self._converter is None:
            return {"text": "", "tables": [], "formulas": [], "metadata": {}}

        try:
            # Convert PDF bytes to Docling document
            result = self._converter.convert(io.BytesIO(pdf_bytes))

            # Extract structured content
            extracted_text = []
            tables = []
            formulas = []

            for element in result.document.iterate_items():
                if element.type == "table":
                    # Extract table as markdown or OTSL
                    table_md = element.export_to_markdown()
                    tables.append({
                        "content": table_md,
                        "bbox": element.prov.bbox if hasattr(element, "prov") else None,
                        "page": element.prov.page if hasattr(element, "prov") else None,
                    })
                    extracted_text.append(f"\n[TABLE]\n{table_md}\n")

                elif element.type == "formula":
                    # Extract formulas as LaTeX
                    formula_latex = element.text or ""
                    formulas.append({
                        "latex": formula_latex,
                        "bbox": element.prov.bbox if hasattr(element, "prov") else None,
                        "page": element.prov.page if hasattr(element, "prov") else None,
                    })
                    extracted_text.append(f"\n[FORMULA] ${formula_latex}$\n")

                else:
                    # Regular text blocks
                    extracted_text.append(element.text or "")

            full_text = "\n".join(extracted_text)

            return {
                "text": full_text,
                "tables": tables,
                "formulas": formulas,
                "metadata": {
                    "num_pages": len(result.document.pages),
                    "num_tables": len(tables),
                    "num_formulas": len(formulas),
                },
            }

        except Exception as e:
            print(f"[WARN] Docling extraction failed: {e}")
            return {"text": "", "tables": [], "formulas": [], "metadata": {}, "error": str(e)}

    def _get_bytes(self, request, name):
        t = pb_utils.get_input_tensor_by_name(request, name)
        if t is None:
            return None
        arr = t.as_numpy()
        if arr is None:
            return None
        try:
            return arr.astype(object)[0][0]
        except Exception:
            try:
                return arr.flat[0]
            except Exception:
                return None

    def execute(self, requests):
        responses = []
        for request in requests:
            pdf_bytes = self._get_bytes(request, "pdf_data")
            prompt_bytes = self._get_bytes(request, "prompt")
            text_bytes = self._get_bytes(request, "text")

            prompt = None
            text = None
            try:
                if prompt_bytes is not None:
                    prompt = prompt_bytes.decode("utf-8", errors="ignore")
                if text_bytes is not None:
                    text = text_bytes.decode("utf-8", errors="ignore")
            except Exception:
                pass

            # Extract PDF with Docling (tables, formulas, text)
            if pdf_bytes is not None:
                extraction = self._extract_with_docling(pdf_bytes)
                extracted_text = extraction["text"]
                tables = extraction["tables"]
                formulas = extraction["formulas"]
                metadata = extraction["metadata"]
            else:
                extracted_text = text or ""
                tables = []
                formulas = []
                metadata = {}

            preview = (extracted_text or "").strip()[:2000]

            response_text = preview
            if prompt:
                response_text = f"Prompt: {prompt}\n\nExcerpt:\n{preview}"

            result = {
                "ok": True,
                "model": "docling_granite_python",
                "backend": "docling" if self._converter else "fallback",
                "received": {
                    "pdf_data": pdf_bytes is not None,
                    "prompt": prompt is not None,
                    "text": text is not None,
                },
                "document": {
                    "chars": int(len(extracted_text)) if extracted_text else 0,
                    "preview": preview,
                    "num_tables": len(tables),
                    "num_formulas": len(formulas),
                },
                "tables": tables,
                "formulas": formulas,
                "metadata": metadata,
                "output": {
                    "text": response_text,
                    "format": "text/plain",
                },
            }

            payload = json.dumps(result).encode("utf-8")
            out_tensor = pb_utils.Tensor("response", np.array([[payload]], dtype=object))
            responses.append(pb_utils.InferenceResponse(output_tensors=[out_tensor]))
        return responses

    def finalize(self):
        self.ready = False
