package main

import (
	"log"
	"sync"
)

type pendingJob struct {
	done chan struct{}
	err  error
}

var (
	pendingMu   sync.Mutex
	pendingJobs = map[string]*pendingJob{}
)

// startAsyncUpload launches the upload in a goroutine and tracks it by key.
func startAsyncUpload(key string, fn func() error) {
	job := &pendingJob{done: make(chan struct{})}
	pendingMu.Lock()
	pendingJobs[key] = job
	pendingMu.Unlock()

	go func() {
		defer close(job.done)
		if err := fn(); err != nil {
			log.Printf("[AsyncUpload] key=%s err=%v", key, err)
			job.err = err
		}
		// Cleanup after done — goroutine already completed
		pendingMu.Lock()
		delete(pendingJobs, key)
		pendingMu.Unlock()
	}()
}

// waitForUpload blocks until the async upload for a key completes (if any).
func waitForUpload(key string) error {
	pendingMu.Lock()
	job, ok := pendingJobs[key]
	pendingMu.Unlock()
	if !ok {
		return nil
	}
	<-job.done
	return job.err
}
