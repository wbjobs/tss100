const schedule = require('node-schedule');
const chalk = require('chalk');

class CronScheduler {
  constructor(options = {}) {
    this.jobs = new Map();
    this.logger = options.logger || console;
    this.allowConcurrent = options.allowConcurrent || false;
    this.runningJobs = new Set();
  }

  _parseInterval(intervalStr) {
    const match = intervalStr.match(/^(\d+)([smhd])$/i);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    if (unit === 'd') return value * 24 * 60 * 60 * 1000;

    return null;
  }

  _buildCronExpression(cron) {
    if (typeof cron === 'string') {
      const parts = cron.trim().split(/\s+/);
      if (parts.length === 5 || parts.length === 6) return cron;
    }

    if (typeof cron === 'object') {
      const { second, minute, hour, dayOfMonth, month, dayOfWeek } = cron;
      return `${second || 0} ${minute || '*'} ${hour || '*'} ${dayOfMonth || '*'} ${month || '*'} ${dayOfWeek || '*'}`;
    }

    return null;
  }

  scheduleJob(name, cronSpec, task, options = {}) {
    if (this.jobs.has(name)) {
      this.cancelJob(name);
    }

    let rule;
    const intervalMs = this._parseInterval(cronSpec);

    if (intervalMs !== null) {
      rule = new schedule.RecurrenceRule();
      const seconds = Math.floor(intervalMs / 1000);

      if (intervalMs < 60000) {
        rule.second = Array.from({ length: 60 }, (_, i) => i).filter(i => i % (intervalMs / 1000) === 0);
      } else if (intervalMs < 3600000) {
        rule.minute = Array.from({ length: 60 }, (_, i) => i).filter(i => i % (intervalMs / 60000) === 0);
      } else if (intervalMs < 86400000) {
        rule.hour = Array.from({ length: 24 }, (_, i) => i).filter(i => i % (intervalMs / 3600000) === 0);
      } else {
        rule.dayOfWeek = Array.from({ length: 7 }, (_, i) => i).filter(i => i % (intervalMs / 86400000) === 0);
      }
    } else {
      rule = this._buildCronExpression(cronSpec) || cronSpec;
    }

    const wrappedTask = async () => {
      if (!this.allowConcurrent && this.runningJobs.has(name)) {
        this.logger.log(chalk.yellow(`[Scheduler] Job "${name}" 已在运行中，跳过本次执行`));
        return;
      }

      this.runningJobs.add(name);
      const startTime = Date.now();

      try {
        this.logger.log(chalk.cyan(`[Scheduler] 开始执行任务 "${name}" at ${new Date().toLocaleTimeString()}`));
        await task();
        const duration = Date.now() - startTime;
        this.logger.log(chalk.green(`[Scheduler] 任务 "${name}" 执行完成，耗时 ${duration}ms`));
      } catch (error) {
        this.logger.log(chalk.red(`[Scheduler] 任务 "${name}" 执行失败: ${error.message}`));
        if (options.onError) {
          try { await options.onError(error); } catch (e) {}
        }
      } finally {
        this.runningJobs.delete(name);
      }
    };

    const job = schedule.scheduleJob(name, rule, wrappedTask);

    if (job) {
      this.jobs.set(name, { job, task: wrappedTask, cronSpec, options });
      const nextInv = job.nextInvocation();
      this.logger.log(chalk.green(`[Scheduler] 任务 "${name}" 已注册，下次执行: ${nextInv ? nextInv.toLocaleString() : '未知'}`));

      if (options.runImmediately) {
        this.logger.log(chalk.cyan(`[Scheduler] 立即执行一次任务 "${name}"`));
        setImmediate(wrappedTask);
      }

      return {
        name,
        cronSpec,
        nextInvocation: nextInv ? nextInv.toISOString() : null,
        cancel: () => this.cancelJob(name),
        runNow: () => this.runJobNow(name)
      };
    }

    return null;
  }

  async runJobNow(name) {
    const jobInfo = this.jobs.get(name);
    if (!jobInfo) return { success: false, error: `Job "${name}" 不存在` };
    try {
      await jobInfo.task();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  cancelJob(name) {
    const jobInfo = this.jobs.get(name);
    if (!jobInfo) return false;

    jobInfo.job.cancel();
    this.jobs.delete(name);
    this.logger.log(chalk.yellow(`[Scheduler] 任务 "${name}" 已取消`));
    return true;
  }

  cancelAll() {
    const names = Array.from(this.jobs.keys());
    names.forEach(name => this.cancelJob(name));
    return names.length;
  }

  listJobs() {
    const jobs = [];
    this.jobs.forEach((info, name) => {
      const nextInv = info.job.nextInvocation();
      jobs.push({
        name,
        cronSpec: info.cronSpec,
        nextInvocation: nextInv ? nextInv.toISOString() : null,
        isRunning: this.runningJobs.has(name)
      });
    });
    return jobs;
  }

  getJob(name) {
    const jobInfo = this.jobs.get(name);
    if (!jobInfo) return null;
    const nextInv = jobInfo.job.nextInvocation();
    return {
      name,
      cronSpec: jobInfo.cronSpec,
      nextInvocation: nextInv ? nextInv.toISOString() : null,
      isRunning: this.runningJobs.has(name),
      options: jobInfo.options
    };
  }

  watch(scheduleConfig, task, options = {}) {
    const name = options.name || 'watch-job';
    const interval = scheduleConfig.interval || scheduleConfig.every || '1h';
    return this.scheduleJob(name, interval, task, options);
  }

  every(intervalStr, task, options = {}) {
    return this.scheduleJob(options.name || `every-${intervalStr}`, intervalStr, task, options);
  }

  at(dateOrCron, task, options = {}) {
    return this.scheduleJob(options.name || `at-${Date.now()}`, dateOrCron, task, options);
  }
}

module.exports = CronScheduler;
