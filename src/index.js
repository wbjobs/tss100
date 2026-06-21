const ConsulAdapter = require('./adapters/consul');
const EurekaAdapter = require('./adapters/eureka');
const DockerComposeAdapter = require('./adapters/docker-compose');
const K8sAdapter = require('./adapters/k8s');
const MockAdapter = require('./adapters/mock');
const DependencyAnalyzer = require('./analyzers/dependency');
const HealthAnalyzer = require('./analyzers/health');
const PerformanceAnalyzer = require('./analyzers/performance');
const CriticalPathAnalyzer = require('./analyzers/critical-path');
const DriftAnalyzer = require('./analyzers/drift');
const AsciiFormatter = require('./formatters/ascii');
const HtmlFormatter = require('./formatters/html');
const FailureSimulator = require('./simulators/failure');
const HistoryStorage = require('./storages/history');
const EmailNotifier = require('./notifiers/email');
const SlackNotifier = require('./notifiers/slack');
const CronScheduler = require('./schedulers/cron');

class MicroserviceTopology {
  constructor(options = {}) {
    this.options = options;
    this.adapter = null;
    this.data = null;
    this.analysis = null;
    this.historyStorage = options.historyStorage || null;
    this.driftAnalyzer = null;
    this.scheduler = null;
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

  _ensureHistoryStorage() {
    if (!this.historyStorage) {
      this.historyStorage = new HistoryStorage(this.options.history || {});
    }
    if (!this.driftAnalyzer) {
      this.driftAnalyzer = new DriftAnalyzer(this.historyStorage, this.options.drift || {});
    }
    return { storage: this.historyStorage, drift: this.driftAnalyzer };
  }

  saveHistory(source = 'unknown') {
    if (!this.analysis) {
      throw new Error('No analysis available, call analyze() first');
    }
    const { storage } = this._ensureHistoryStorage();
    return storage.saveSnapshot(this.analysis, source);
  }

  compareHistory(options = {}) {
    if (!this.analysis) {
      throw new Error('No analysis available, call analyze() first');
    }
    const { storage, drift } = this._ensureHistoryStorage();

    const currentSnapshot = storage.saveSnapshot(this.analysis, options.source || 'unknown').snapshot;
    const driftResult = drift.detect(currentSnapshot);

    return {
      currentSnapshot,
      drift: driftResult,
      reportText: drift.formatDriftReport(driftResult, 'text'),
      reportHtml: drift.formatDriftReport(driftResult, 'html'),
      storageStats: storage.getStats()
    };
  }

  getHistoryStats() {
    const { storage } = this._ensureHistoryStorage();
    return storage.getStats();
  }

  listHistory(options = {}) {
    const { storage } = this._ensureHistoryStorage();
    return storage.listSnapshots(options);
  }

  clearHistory() {
    const { storage } = this._ensureHistoryStorage();
    return storage.clearAll();
  }

  async notify(type, config, options = {}) {
    if (!this.analysis) {
      throw new Error('No analysis available, call analyze() first');
    }

    let notifier;
    if (type === 'email') {
      notifier = new EmailNotifier(config);
    } else if (type === 'slack') {
      notifier = new SlackNotifier(config);
    } else {
      throw new Error(`Unknown notification type: ${type}`);
    }

    let result;
    const notifyType = options.notifyType || 'analysis';

    if (notifyType === 'analysis') {
      result = await notifier.sendAnalysisReport(this.analysis, options);
    } else if (notifyType === 'drift') {
      if (!options.driftResult) {
        throw new Error('driftResult is required for drift notification');
      }
      result = await notifier.sendDriftReport(options.driftResult, this.analysis, options);
    } else if (notifyType === 'failure') {
      if (!options.simulationResult) {
        throw new Error('simulationResult is required for failure notification');
      }
      result = await notifier.sendFailureReport(options.simulationResult, this.analysis, options);
    } else {
      throw new Error(`Unknown notify type: ${notifyType}`);
    }

    return {
      notifier: type,
      notifyType,
      ...result
    };
  }

  schedule(source, scheduleOptions, options = {}) {
    if (!this.scheduler) {
      this.scheduler = new CronScheduler(options.scheduler || {});
    }

    const task = async () => {
      try {
        await this.collect(options.service || null);
        this.analyze();

        if (options.saveHistory !== false) {
          this.saveHistory(source);
        }

        if (options.enableDriftDetection) {
          const comparison = this.compareHistory({ source });
          if (comparison.drift.hasAnomalies && options.notifyOnDrift) {
            const notifierConfig = options.notifier || {};
            if (notifierConfig.type === 'email' && notifierConfig.email) {
              await this.notify('email', notifierConfig.email, {
                notifyType: 'drift',
                driftResult: comparison.drift,
                severityThreshold: notifierConfig.severityThreshold || 'warning'
              });
            }
            if (notifierConfig.type === 'slack' && notifierConfig.slack) {
              await this.notify('slack', notifierConfig.slack, {
                notifyType: 'drift',
                driftResult: comparison.drift,
                severityThreshold: notifierConfig.severityThreshold || 'warning'
              });
            }
          }
        }

        if (options.notifyOnDegraded) {
          const status = this.analysis.health.summary.overallStatus;
          if (status !== 'healthy') {
            const notifierConfig = options.notifier || {};
            if (notifierConfig.type === 'email' && notifierConfig.email) {
              await this.notify('email', notifierConfig.email, {
                notifyType: 'analysis',
                severityThreshold: notifierConfig.analysisSeverityThreshold || 'degraded'
              });
            }
            if (notifierConfig.type === 'slack' && notifierConfig.slack) {
              await this.notify('slack', notifierConfig.slack, {
                notifyType: 'analysis',
                severityThreshold: notifierConfig.analysisSeverityThreshold || 'degraded'
              });
            }
          }
        }

        if (options.onComplete) {
          try {
            await options.onComplete(this.analysis);
          } catch (e) {}
        }

        return this.analysis;
      } catch (error) {
        if (options.onError) {
          try { await options.onError(error); } catch (e) {}
        }
        throw error;
      }
    };

    const jobName = options.name || `ms-topology-${source}`;
    const interval = scheduleOptions.every || scheduleOptions.interval || '1h';

    return this.scheduler.scheduleJob(jobName, interval, task, {
      runImmediately: options.runImmediately !== false
    });
  }

  watch(source, options = {}) {
    const interval = options.every || options.interval || '1m';
    return this.schedule(source, { every: interval }, {
      ...options,
      name: options.name || `watch-${source}`,
      enableDriftDetection: true,
      notifyOnDrift: true,
      notifyOnDegraded: true
    });
  }

  stopSchedule(jobName) {
    if (!this.scheduler) return false;
    if (jobName) {
      return this.scheduler.cancelJob(jobName);
    }
    return this.scheduler.cancelAll();
  }

  listSchedules() {
    if (!this.scheduler) return [];
    return this.scheduler.listJobs();
  }

  stopAllSchedules() {
    return this.stopSchedule();
  }

  getAnalysis() {
    return this.analysis;
  }

  getData() {
    return this.data;
  }
}

module.exports = MicroserviceTopology;
