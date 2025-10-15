package main

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	webhooksTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "sink_webhooks_total",
			Help: "Count of webhooks received by sink",
		},
		[]string{"action", "valid", "task_type"},
	)

	enqueueTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "sink_enqueue_total",
			Help: "Count of annotation enqueue attempts",
		},
		[]string{"repo", "task_type", "status"},
	)

	outboxCommitsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "sink_outbox_commits_total",
			Help: "Count of outbox commit attempts",
		},
		[]string{"repo", "status"},
	)

	outboxRecordsProcessedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "sink_outbox_records_processed_total",
			Help: "Number of outbox records marked processed",
		},
		[]string{"repo"},
	)

	outboxRecordsFailedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "sink_outbox_records_failed_total",
			Help: "Number of outbox records marked failed",
		},
		[]string{"repo"},
	)
)

func initMetrics() {
	prometheus.MustRegister(webhooksTotal)
	prometheus.MustRegister(enqueueTotal)
	prometheus.MustRegister(outboxCommitsTotal)
	prometheus.MustRegister(outboxRecordsProcessedTotal)
	prometheus.MustRegister(outboxRecordsFailedTotal)
}
