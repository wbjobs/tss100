class ResilienceModel {
  constructor(edge) {
    this.circuitBreaker = edge.circuitBreaker || null;
    this.retry = edge.retry || null;
    this.fallback = edge.fallback || null;
  }

  isCircuitBreakerOpen() {
    if (!this.circuitBreaker) return false;
    return this.circuitBreaker.state === 'open';
  }

  isCircuitBreakerHalfOpen() {
    if (!this.circuitBreaker) return false;
    return this.circuitBreaker.state === 'half-open';
  }

  isCircuitBreakerClosed() {
    if (!this.circuitBreaker) return false;
    return this.circuitBreaker.state === 'closed';
  }

  getEffectiveErrorRate(baseErrorRate) {
    let rate = baseErrorRate;

    if (this.circuitBreaker) {
      if (this.circuitBreaker.state === 'open') {
        rate = 100;
      } else if (this.circuitBreaker.state === 'half-open') {
        rate = Math.min(100, rate * 0.5);
      } else {
        const threshold = this.circuitBreaker.errorThresholdPercentage || 50;
        if (baseErrorRate >= threshold) {
          rate = Math.min(100, baseErrorRate * 1.2);
        } else {
          rate = baseErrorRate;
        }
      }
    }

    return rate;
  }

  getAdjustedFailureProbability(baseProbability) {
    let prob = baseProbability;

    if (this.circuitBreaker) {
      if (this.circuitBreaker.state === 'open') {
        return 0;
      }
      if (this.circuitBreaker.state === 'half-open') {
        prob *= 0.3;
      }
    }

    if (this.retry) {
      const maxRetries = this.retry.maxRetries || 0;
      const retryBackoff = this.retry.backoffMs || 100;
      prob *= Math.pow(0.5, maxRetries);
    }

    if (this.fallback) {
      prob *= (1 - (this.fallback.successRate || 0.8));
    }

    return prob;
  }

  getImpactReduction() {
    let reduction = 0;

    if (this.circuitBreaker) {
      if (this.circuitBreaker.state === 'open') {
        reduction += 0.7;
      } else if (this.circuitBreaker.state === 'half-open') {
        reduction += 0.3;
      } else {
        reduction += 0.15;
      }
    }

    if (this.retry) {
      const maxRetries = this.retry.maxRetries || 0;
      reduction += maxRetries * 0.1;
    }

    if (this.fallback) {
      reduction += this.fallback.successRate || 0.8;
    }

    return Math.min(0.95, reduction);
  }

  getDegradedLatency(baseLatency) {
    let latency = baseLatency;

    if (this.fallback) {
      return this.fallback.avgLatency || Math.round(baseLatency * 0.3);
    }

    if (this.retry) {
      const maxRetries = this.retry.maxRetries || 0;
      const backoff = this.retry.backoffMs || 100;
      latency += maxRetries * backoff * 0.5;
    }

    if (this.circuitBreaker && this.circuitBreaker.state === 'half-open') {
      latency *= 1.5;
    }

    return Math.round(latency);
  }

  getDescription() {
    const parts = [];

    if (this.circuitBreaker) {
      parts.push(`熔断[${this.circuitBreaker.state}]`);
      if (this.circuitBreaker.errorThresholdPercentage) {
        parts.push(`阈值${this.circuitBreaker.errorThresholdPercentage}%`);
      }
    }

    if (this.retry) {
      parts.push(`重试${this.retry.maxRetries || 0}次`);
    }

    if (this.fallback) {
      parts.push(`降级→${this.fallback.target}`);
      parts.push(`成功率${Math.round((this.fallback.successRate || 0.8) * 100)}%`);
    }

    return parts.length > 0 ? parts.join(', ') : '无容错机制';
  }
}

module.exports = ResilienceModel;
