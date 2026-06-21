class PerformanceAnalyzer {
  constructor(data) {
    this.data = data;
  }

  analyze() {
    const serviceMetrics = {};
    const edgeMetrics = {};

    this.data.services.forEach(service => {
      serviceMetrics[service.name] = {
        name: service.name,
        incomingCalls: [],
        outgoingCalls: [],
        totalIncomingRequests: 0,
        totalOutgoingRequests: 0,
        avgIncomingLatency: 0,
        avgOutgoingLatency: 0,
        errorRate: 0,
        p99Latency: 0
      };
    });

    this.data.calls.forEach(call => {
      const edgeKey = `${call.from}->${call.to}`;
      edgeMetrics[edgeKey] = {
        from: call.from,
        to: call.to,
        avgLatency: call.avgLatency,
        p99Latency: call.p99Latency,
        errorRate: call.errorRate,
        requestCount: call.requestCount,
        load: this.calculateLoad(call)
      };

      if (serviceMetrics[call.from]) {
        serviceMetrics[call.from].outgoingCalls.push({
          service: call.to,
          ...edgeMetrics[edgeKey]
        });
        serviceMetrics[call.from].totalOutgoingRequests += call.requestCount;
      }

      if (serviceMetrics[call.to]) {
        serviceMetrics[call.to].incomingCalls.push({
          service: call.from,
          ...edgeMetrics[edgeKey]
        });
        serviceMetrics[call.to].totalIncomingRequests += call.requestCount;
      }
    });

    Object.values(serviceMetrics).forEach(metric => {
      if (metric.incomingCalls.length > 0) {
        const totalWeight = metric.incomingCalls.reduce((sum, c) => sum + c.requestCount, 0);
        metric.avgIncomingLatency = totalWeight > 0
          ? metric.incomingCalls.reduce((sum, c) => sum + c.avgLatency * c.requestCount, 0) / totalWeight
          : 0;
        metric.p99Latency = Math.max(...metric.incomingCalls.map(c => c.p99Latency), 0);
        metric.errorRate = totalWeight > 0
          ? metric.incomingCalls.reduce((sum, c) => sum + c.errorRate * c.requestCount, 0) / totalWeight
          : 0;
      }

      if (metric.outgoingCalls.length > 0) {
        const totalWeight = metric.outgoingCalls.reduce((sum, c) => sum + c.requestCount, 0);
        metric.avgOutgoingLatency = totalWeight > 0
          ? metric.outgoingCalls.reduce((sum, c) => sum + c.avgLatency * c.requestCount, 0) / totalWeight
          : 0;
      }
    });

    return {
      serviceMetrics,
      edgeMetrics,
      slowEdges: this.findSlowEdges(edgeMetrics),
      highErrorEdges: this.findHighErrorEdges(edgeMetrics),
      highLoadServices: this.findHighLoadServices(serviceMetrics),
      bottlenecks: this.identifyBottlenecks(serviceMetrics, edgeMetrics)
    };
  }

  calculateLoad(call) {
    const latencyScore = call.avgLatency / 100;
    const errorScore = call.errorRate / 5;
    const requestScore = Math.min(call.requestCount / 100000, 1);
    return (latencyScore * 0.4 + errorScore * 0.4 + requestScore * 0.2) * 100;
  }

  findSlowEdges(edgeMetrics, threshold = 100) {
    return Object.values(edgeMetrics)
      .filter(e => e.avgLatency > threshold)
      .sort((a, b) => b.avgLatency - a.avgLatency);
  }

  findHighErrorEdges(edgeMetrics, threshold = 2) {
    return Object.values(edgeMetrics)
      .filter(e => e.errorRate > threshold)
      .sort((a, b) => b.errorRate - a.errorRate);
  }

  findHighLoadServices(serviceMetrics, threshold = 50000) {
    return Object.values(serviceMetrics)
      .filter(s => s.totalIncomingRequests > threshold)
      .sort((a, b) => b.totalIncomingRequests - a.totalIncomingRequests);
  }

  identifyBottlenecks(serviceMetrics, edgeMetrics) {
    const bottlenecks = [];

    Object.values(edgeMetrics).forEach(edge => {
      const issues = [];
      
      if (edge.avgLatency > 200) {
        issues.push({ type: 'high_latency', message: `延迟过高: ${edge.avgLatency}ms` });
      }
      
      if (edge.errorRate > 5) {
        issues.push({ type: 'high_error_rate', message: `错误率过高: ${edge.errorRate.toFixed(2)}%` });
      }

      if (edge.p99Latency > edge.avgLatency * 3) {
        issues.push({ type: 'high_tail_latency', message: `长尾延迟严重: P99=${edge.p99Latency}ms, 平均=${edge.avgLatency}ms` });
      }

      if (issues.length > 0) {
        bottlenecks.push({
          edge: `${edge.from} -> ${edge.to}`,
          from: edge.from,
          to: edge.to,
          load: edge.load,
          issues
        });
      }
    });

    return bottlenecks.sort((a, b) => b.load - a.load);
  }

  getServicePerformance(serviceName) {
    const result = this.analyze();
    return result.serviceMetrics[serviceName];
  }

  getEdgePerformance(from, to) {
    const result = this.analyze();
    return result.edgeMetrics[`${from}->${to}`];
  }

  getOverallStatistics() {
    const result = this.analyze();
    const edges = Object.values(result.edgeMetrics);

    if (edges.length === 0) {
      return {
        avgLatency: 0,
        avgErrorRate: 0,
        totalRequests: 0,
        slowEdgeCount: 0,
        highErrorEdgeCount: 0
      };
    }

    const totalLatency = edges.reduce((sum, e) => sum + e.avgLatency, 0);
    const totalErrorRate = edges.reduce((sum, e) => sum + e.errorRate, 0);
    const totalRequests = edges.reduce((sum, e) => sum + e.requestCount, 0);

    return {
      avgLatency: Math.round(totalLatency / edges.length),
      avgErrorRate: (totalErrorRate / edges.length).toFixed(2),
      totalRequests,
      slowEdgeCount: result.slowEdges.length,
      highErrorEdgeCount: result.highErrorEdges.length
    };
  }
}

module.exports = PerformanceAnalyzer;
