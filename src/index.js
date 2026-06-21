const ConsulAdapter = require('./adapters/consul');
const EurekaAdapter = require('./adapters/eureka');
const DockerComposeAdapter = require('./adapters/docker-compose');
const K8sAdapter = require('./adapters/k8s');
const MockAdapter = require('./adapters/mock');
const DependencyAnalyzer = require('./analyzers/dependency');
const HealthAnalyzer = require('./analyzers/health');
const PerformanceAnalyzer = require('./analyzers/performance');
const CriticalPathAnalyzer = require('./analyzers/critical-path');
const AsciiFormatter = require('./formatters/ascii');
const HtmlFormatter = require('./formatters/html');
const FailureSimulator = require('./simulators/failure');

class MicroserviceTopology {
  constructor(options = {}) {
    this.options = options;
    this.adapter = null;
    this.data = null;
    this.analysis = null;
  }

  async connect(source, config = {}) {
    switch (source) {
      case 'consul':
        this.adapter = new ConsulAdapter(config);
        break;
      case 'eureka':
        this.adapter = new EurekaAdapter(config);
        break;
      case 'docker-compose':
        this.adapter = new DockerComposeAdapter(config);
        break;
      case 'k8s':
        this.adapter = new K8sAdapter(config);
        break;
      case 'mock':
        this.adapter = new MockAdapter(config);
        break;
      default:
        throw new Error(`Unknown data source: ${source}`);
    }
    await this.adapter.connect();
    return this;
  }

  async collect(serviceName = null) {
    if (!this.adapter) {
      throw new Error('Not connected to any data source');
    }
    this.data = await this.adapter.collect(serviceName);
    return this.data;
  }

  analyze() {
    if (!this.data) {
      throw new Error('No data collected yet');
    }

    const depAnalyzer = new DependencyAnalyzer(this.data);
    const dependencies = depAnalyzer.analyze();

    const healthAnalyzer = new HealthAnalyzer(this.data);
    const health = healthAnalyzer.analyze();

    const perfAnalyzer = new PerformanceAnalyzer(this.data);
    const performance = perfAnalyzer.analyze();

    const cpAnalyzer = new CriticalPathAnalyzer(this.data, dependencies, performance);
    const criticalPath = cpAnalyzer.findCriticalPath();

    this.analysis = {
      dependencies,
      health,
      performance,
      criticalPath,
      services: this.data.services
    };

    return this.analysis;
  }

  format(formatType, options = {}) {
    if (!this.analysis) {
      throw new Error('No analysis available, call analyze() first');
    }

    let formatter;
    switch (formatType) {
      case 'ascii':
        formatter = new AsciiFormatter(this.analysis, options);
        break;
      case 'html':
        formatter = new HtmlFormatter(this.analysis, options);
        break;
      default:
        throw new Error(`Unknown format: ${formatType}`);
    }

    return formatter.format();
  }

  simulateFailure(serviceName) {
    if (!this.analysis) {
      throw new Error('No analysis available, call analyze() first');
    }

    const simulator = new FailureSimulator(this.analysis);
    return simulator.simulateFailure(serviceName);
  }

  getAnalysis() {
    return this.analysis;
  }

  getData() {
    return this.data;
  }
}

module.exports = MicroserviceTopology;
