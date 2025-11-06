package oceanid.policies

import future.keywords.if
import future.keywords.in

###############################
# Container Resource Policies #
###############################

deny[msg] if {
    some container in containers(input)
    not has_limit(container, "memory")
    msg := sprintf("Container '%s' missing memory limits", [container_name(container)])
}

deny[msg] if {
    some container in containers(input)
    not has_limit(container, "cpu")
    msg := sprintf("Container '%s' missing CPU limits", [container_name(container)])
}

warn[msg] if {
    some container in containers(input)
    limit := resource_limit(container, "memory")
    limit != null
    bytes := parse_memory(limit)
    bytes > 2 * 1024 * 1024 * 1024 # > 2GiB
    msg := sprintf("Container '%s' requests excessive memory: %v", [container_name(container), limit])
}

warn[msg] if {
    some container in containers(input)
    limit := resource_limit(container, "cpu")
    limit != null
    cores := parse_cpu(limit)
    cores > 2
    msg := sprintf("Container '%s' requests excessive CPU: %v", [container_name(container), limit])
}

#########################
# Service-Type Policies #
#########################

deny[msg] if {
    is_service(input)
    lower(service_type(input)) == "nodeport"
    msg := "NodePort services are prohibited. Use ClusterIP with Cloudflare Tunnel."
}

deny[msg] if {
    is_service(input)
    lower(service_type(input)) == "loadbalancer"
    msg := "LoadBalancer services are prohibited. Use Cloudflare Tunnel + Gateway API."
}

###############
# Pod Security #
###############

deny[msg] if {
    some container in containers(input)
    is_root(container)
    msg := sprintf("Container '%s' runs as root (UID 0).", [container_name(container)])
}

deny[msg] if {
    some container in containers(input)
    missing_security_context(container)
    msg := sprintf("Container '%s' is missing a securityContext.", [container_name(container)])
}

deny[msg] if {
    some container in containers(input)
    privileged := object.get(security_context(container), "privileged", false)
    privileged == true
    msg := sprintf("Container '%s' requests privileged mode.", [container_name(container)])
}

deny[msg] if {
    host_network_enabled(input)
    msg := sprintf("%s enables hostNetwork, which is not permitted.", [resource_label(input)])
}

deny[msg] if {
    host_pid_enabled(input)
    msg := sprintf("%s enables hostPID, which is not permitted.", [resource_label(input)])
}

###################
# Namespace Labels #
###################

deny[msg] if {
    input.kind == "Namespace"
    not has_label(input, "oceanid.cluster/managed-by")
    msg := "Namespace missing 'oceanid.cluster/managed-by' label."
}

###############################
# Flux Controller Placement   #
###############################

deny[msg] if {
    input.kind == "Deployment"
    name := lower(object.get(input.metadata, "name", ""))
    controllers := {"source-controller", "kustomize-controller", "helm-controller", "notification-controller", "image-automation-controller", "image-reflector-controller"}
    name in controllers
    ns := lower(object.get(input.metadata, "namespace", "default"))
    ns != "flux-system"
    msg := sprintf("Flux controller '%s' must run in 'flux-system' (found namespace '%s').", [name, ns])
}

deny[msg] if {
    input.kind == "Namespace"
    not has_label(input, "oceanid.cluster/component")
    msg := "Namespace missing 'oceanid.cluster/component' label."
}

warn[msg] if {
    input.kind == "Namespace"
    namespace := input.metadata.name
    namespace != "kube-system"
    namespace != "kube-public"
    namespace != "flux-system"
    msg := sprintf("Namespace '%s' should define at least one NetworkPolicy.", [namespace])
}

####################
# Ingress Policies #
####################

deny[msg] if {
    input.kind == "Ingress"
    msg := "Ingress resources are prohibited. Use Cloudflare Tunnels via Gateway API."
}

#############################
# Labeling & Annotation Policy
#############################

deny[msg] if {
    requires_standard_labels(input)
    not has_label(input, "app.kubernetes.io/name")
    msg := "Missing required label: app.kubernetes.io/name."
}

deny[msg] if {
    requires_standard_labels(input)
    not has_label(input, "app.kubernetes.io/managed-by")
    msg := "Missing required label: app.kubernetes.io/managed-by."
}

deny[msg] if {
    input.kind == "Secret"
    not has_annotation(input, "oceanid.cluster/encrypted")
    msg := "Secret must have 'oceanid.cluster/encrypted' annotation."
}

#############
# RBAC Rules #
#############

deny[msg] if {
    input.kind in ["ClusterRole", "Role"]
    some rule in object.get(input, "rules", [])
    some verb in object.get(rule, "verbs", [])
    verb == "*"
    some resource in object.get(rule, "resources", [])
    resource == "*"
    msg := "RBAC rules must not grant wildcard verb/resource permissions."
}

####################
# Storage Policy #
####################

deny[msg] if {
    input.kind == "PersistentVolumeClaim"
    not input.spec.storageClassName
    msg := "PersistentVolumeClaim must specify a storage class."
}

####################
# Helper Functions #
####################

containers(resource) := containers if {
    resource.kind == "Pod"
    containers := object.get(resource.spec, "containers", [])
} else := containers if {
    resource.kind in ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"]
    template := object.get(resource.spec, "template", {})
    spec := object.get(template, "spec", {})
    containers := object.get(spec, "containers", [])
} else := containers if {
    resource.kind == "CronJob"
    job := object.get(resource.spec, "jobTemplate", {})
    job_spec := object.get(job, "spec", {})
    template := object.get(job_spec, "template", {})
    spec := object.get(template, "spec", {})
    containers := object.get(spec, "containers", [])
} else := []

pod_spec(resource) := spec if {
    resource.kind == "Pod"
    spec := object.get(resource, "spec", {})
} else := spec if {
    resource.kind in ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"]
    template := object.get(resource.spec, "template", {})
    spec := object.get(template, "spec", {})
} else := spec if {
    resource.kind == "CronJob"
    job := object.get(resource.spec, "jobTemplate", {})
    job_spec := object.get(job, "spec", {})
    template := object.get(job_spec, "template", {})
    spec := object.get(template, "spec", {})
} else := {}

container_name(container) := object.get(container, "name", "unnamed")

container_limits(container) := limits if {
    resources := object.get(container, "resources", {})
    limits := object.get(resources, "limits", {})
} else := {}

security_context(container) := object.get(container, "securityContext", {})

resource_limit(container, key) := value if {
    limits := container_limits(container)
    value := object.get(limits, key, null)
}

has_limit(container, key) if {
    resource_limit(container, key) != null
}

missing_security_context(container) if {
    sc := security_context(container)
    sc == {}
}

is_root(container) if {
    sc := security_context(container)
    user := object.get(sc, "runAsUser", null)
    user == 0
}

host_network_enabled(resource) if {
    spec := pod_spec(resource)
    object.get(spec, "hostNetwork", false) == true
}

host_pid_enabled(resource) if {
    spec := pod_spec(resource)
    object.get(spec, "hostPID", false) == true
}

is_service(resource) if {
    resource.kind == "Service"
}

service_type(resource) := lower(object.get(resource.spec, "type", "ClusterIP")) if {
    is_service(resource)
}

requires_standard_labels(resource) if {
    resource.kind in ["Deployment", "Service", "StatefulSet", "DaemonSet"]
}

has_label(resource, key) if {
    labels := object.get(resource.metadata, "labels", {})
    labels[key]
}

has_annotation(resource, key) if {
    annotations := object.get(resource.metadata, "annotations", {})
    annotations[key]
}

resource_label(resource) := sprintf("%s/%s", [lower(resource.kind), object.get(resource.metadata, "name", "unnamed")])

parse_memory(value) := parsed if {
    is_number(value)
    parsed := value
}

parse_memory(value) := parsed if {
    is_string(value)
    endswith(value, "Gi")
    num := trim_suffix(value, "Gi")
    parsed := to_number(num) * 1024 * 1024 * 1024
}

parse_memory(value) := parsed if {
    is_string(value)
    endswith(value, "Mi")
    num := trim_suffix(value, "Mi")
    parsed := to_number(num) * 1024 * 1024
}

parse_memory(value) := parsed if {
    is_string(value)
    endswith(value, "Ki")
    num := trim_suffix(value, "Ki")
    parsed := to_number(num) * 1024
}

parse_memory(value) := parsed if {
    is_string(value)
    regex.match(`^[0-9]+$`, value)
    parsed := to_number(value)
}

parse_cpu(value) := parsed if {
    is_number(value)
    parsed := value
}

parse_cpu(value) := parsed if {
    is_string(value)
    endswith(value, "m")
    num := trim_suffix(value, "m")
    parsed := to_number(num) / 1000
}

parse_cpu(value) := parsed if {
    is_string(value)
    regex.match(`^[0-9]+(\.[0-9]+)?$`, value)
    parsed := to_number(value)
}
