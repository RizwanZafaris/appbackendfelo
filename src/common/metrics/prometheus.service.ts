import { Injectable, Logger } from '@nestjs/common';

interface MetricValue {
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

@Injectable()
export class PrometheusService {
  private readonly logger = new Logger(PrometheusService.name);
  private counters = new Map<string, number>();
  private gauges = new Map<string, MetricValue>();
  private histograms = new Map<string, number[]>();
  private histogramBuckets = new Map<string, number[]>();

  counter(name: string, value = 1, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauges.set(this.key(name, labels), { value, labels, timestamp: Date.now() });
  }

  histogram(name: string, value: number, labels: Record<string, string> = {}, buckets: number[] = [0.1, 0.5, 1, 2, 5, 10]): void {
    const key = this.key(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
      this.histogramBuckets.set(key, buckets);
    }
    this.histograms.get(key)!.push(value);
  }

  private key(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  generateMetrics(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, value] of this.counters) {
      const name = key.split('{')[0];
      lines.push(`# HELP ${name} counter`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, metric] of this.gauges) {
      const name = key.split('{')[0];
      lines.push(`# HELP ${name} gauge`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${key} ${metric.value}`);
    }

    // Histograms
    for (const [key, values] of this.histograms) {
      const name = key.split('{')[0];
      const buckets = this.histogramBuckets.get(key) || [0.1, 0.5, 1, 2, 5, 10];
      
      lines.push(`# HELP ${name} histogram`);
      lines.push(`# TYPE ${name} histogram`);
      
      for (const bucket of buckets) {
        const count = values.filter(v => v <= bucket).length;
        lines.push(`${name}_bucket{le="${bucket}",${this.extractLabels(key)}} ${count}`);
      }
      lines.push(`${name}_bucket{le="+Inf",${this.extractLabels(key)}} ${values.length}`);
      lines.push(`${name}_sum{${this.extractLabels(key)}} ${values.reduce((a, b) => a + b, 0)}`);
      lines.push(`${name}_count{${this.extractLabels(key)}} ${values.length}`);
    }

    return lines.join('\n');
  }

  private extractLabels(key: string): string {
    const match = key.match(/\{(.+)\}/);
    return match ? match[1] : '';
  }
}
