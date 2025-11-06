> Archived — November 2025

# (Archived) Label Studio ML Backend Connection

Label Studio and the `ls-triton-adapter` service have been removed from the Oceanid stack. This document is retained for historical reference only.

Current approach:
- Triton Inference Server runs on Calypso and is exposed via the Cloudflare Node Tunnel at `https://gpu.<base>`.
- Services interact with Triton directly using the Triton HTTP v2 API.
- See the updated Networking Architecture and GPU Access sections in the root README.
