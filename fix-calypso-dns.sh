#!/bin/bash
# Fix DNS for calypso by configuring pods to use Cloudflare DNS directly

echo "Applying DNS fix for calypso node..."

kubectl --kubeconfig ~/.kube/k3s-hostinger.yaml apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: nodelocaldns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        forward . 1.1.1.1 1.0.0.1
        cache 30
        loop
        reload
        loadbalance
    }
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: nodelocaldns
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: nodelocaldns
  template:
    metadata:
      labels:
        app: nodelocaldns
    spec:
      nodeSelector:
        kubernetes.io/hostname: calypso
      tolerations:
        - key: workload-type
          operator: Equal
          value: gpu-compute
          effect: NoSchedule
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: coredns
          image: coredns/coredns:latest
          args: ["-conf", "/etc/coredns/Corefile"]
          volumeMounts:
            - name: config-volume
              mountPath: /etc/coredns
          ports:
            - containerPort: 53
              protocol: UDP
              hostPort: 53
            - containerPort: 53
              protocol: TCP
              hostPort: 53
      volumes:
        - name: config-volume
          configMap:
            name: nodelocaldns
EOF

echo "DNS fix applied. Restarting Flux pods..."
kubectl --kubeconfig ~/.kube/k3s-hostinger.yaml delete pods --all -n flux-system

echo "Waiting for pods to restart..."
sleep 10

echo "Checking Flux status..."
kubectl --kubeconfig ~/.kube/k3s-hostinger.yaml get gitrepositories -n flux-system
