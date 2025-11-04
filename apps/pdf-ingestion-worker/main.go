package main

import (
	"log"
	"time"
)

// Minimal scaffold; replace with Redis consumer and idempotent handlers.
func main() {
	log.Println("pdf-ingestion-worker starting (scaffold)")
	// Idle loop to keep container alive in early scaffolding.
	for {
		time.Sleep(30 * time.Second)
		log.Println("pdf-ingestion-worker heartbeat")
	}
}
