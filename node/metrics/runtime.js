import { performance } from "node:perf_hooks";

// Event loop utilization (ELU): fraction of time the main thread was busy
// (0..1). Node runs the app on a single thread, so ELU close to 1 means the
// process is saturated even if system CPU is below 100% (GC and libuv use
// other threads, and the VM has 2 vCPU).
// Also the process CPU (all threads), in cores.
export function createRuntimeSampler(metrics, { now = () => performance.now() } = {}) {
  let lastElu = performance.eventLoopUtilization();
  let lastCpu = process.cpuUsage();
  let lastT = now();

  return function sample() {
    const elu = performance.eventLoopUtilization(lastElu).utilization;
    const cpu = process.cpuUsage(lastCpu);
    const t = now();
    const cores = (cpu.user + cpu.system) / 1000 / (t - lastT);

    metrics.gauge("node.event_loop_utilization", Number(elu.toFixed(3)));
    metrics.gauge("node.process_cpu_cores", Number(cores.toFixed(3)));

    lastElu = performance.eventLoopUtilization();
    lastCpu = process.cpuUsage();
    lastT = t;
    return { elu, cores };
  };
}

export function startRuntimeMetrics(metrics, intervalMs = 10000) {
  const sample = createRuntimeSampler(metrics);
  const timer = setInterval(sample, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
