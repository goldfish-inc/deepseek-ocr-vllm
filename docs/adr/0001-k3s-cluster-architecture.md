# ADR-0001: K3s Cluster Architecture

**Date**: 2025-09-01
**Status**: Accepted
**Author**: Infrastructure Team

## Context

We need a lightweight Kubernetes distribution that can run on bare metal servers while providing production-grade features.

## Decision

We will use K3s as our Kubernetes distribution with:

- 3-node cluster (1 control plane, 2 workers)
- Flux CD for GitOps deployment
- Cloudflare Tunnel for secure ingress
- Pulumi for infrastructure as code

## Consequences

### Positive

- Lightweight and resource-efficient
- Built-in etcd for high availability
- Easy to manage and upgrade
- Native support for ARM64 (GPU nodes)

### Negative

- Some enterprise features require additional configuration
- Smaller ecosystem compared to full Kubernetes
- Limited to single-region deployment

## References

- [K3s Documentation](https://docs.k3s.io)
- [Flux CD Documentation](https://fluxcd.io)
- [Pulumi Documentation](https://www.pulumi.com)
