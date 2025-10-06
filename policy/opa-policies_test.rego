package oceanid.policies

import future.keywords.if

# Test that pods without resource limits are denied
test_deny_missing_memory_limits if {
    deny[_] with input as {
        "kind": "Pod",
        "spec": {
            "containers": [{
                "name": "test-container",
                "resources": {}
            }]
        }
    }
}

# Test that pods with resource limits pass
test_allow_with_limits if {
    count(deny) == 0 with input as {
        "kind": "Pod",
        "spec": {
            "containers": [{
                "name": "test-container",
                "resources": {
                    "limits": {
                        "memory": "1Gi",
                        "cpu": "500m"
                    }
                },
                "securityContext": {
                    "runAsUser": 1000
                }
            }]
        }
    }
}

# Test NodePort service denial
test_deny_nodeport if {
    deny[_] with input as {
        "kind": "Service",
        "spec": {
            "type": "NodePort"
        }
    }
}

# Test LoadBalancer service denial
test_deny_loadbalancer if {
    deny[_] with input as {
        "kind": "Service",
        "spec": {
            "type": "LoadBalancer"
        }
    }
}

# Test ClusterIP service is allowed
test_allow_clusterip if {
    count(deny) == 0 with input as {
        "kind": "Service",
        "metadata": {
            "name": "test-service",
            "labels": {
                "app.kubernetes.io/name": "test",
                "app.kubernetes.io/managed-by": "pulumi"
            }
        },
        "spec": {
            "type": "ClusterIP"
        }
    }
}

# Test container running as root is denied
test_deny_root_container if {
    deny[_] with input as {
        "kind": "Deployment",
        "spec": {
            "template": {
                "spec": {
                    "containers": [{
                        "name": "root-container",
                        "securityContext": {
                            "runAsUser": 0
                        }
                    }]
                }
            }
        }
    }
}

# Test missing namespace labels
test_deny_missing_namespace_labels if {
    deny[_] with input as {
        "kind": "Namespace",
        "metadata": {
            "name": "test-namespace",
            "labels": {}
        }
    }
}

# Test Ingress denial
test_deny_ingress if {
    deny[_] with input as {
        "kind": "Ingress",
        "metadata": {
            "name": "test-ingress"
        }
    }
}

# Test RBAC wildcard denial
test_deny_rbac_wildcard if {
    deny[_] with input as {
        "kind": "ClusterRole",
        "rules": [{
            "verbs": ["*"],
            "resources": ["*"]
        }]
    }
}

# Test PVC without storage class
test_deny_pvc_no_storage_class if {
    deny[_] with input as {
        "kind": "PersistentVolumeClaim",
        "spec": {
            "resources": {
                "requests": {
                    "storage": "10Gi"
                }
            }
        }
    }
}
