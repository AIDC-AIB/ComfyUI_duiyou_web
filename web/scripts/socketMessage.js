/**
 * @typedef {import('@ali/comfyui/esm/types.js').Model} IModel
 * @typedef {import('@ali/comfyui/esm/types.js').WorkflowSetData} IWorkflow
 * @typedef {import('../types/litegraph.js').IWidget} IWidget
 * @typedef {import('../types/app.js').ValidateError} ValidateError
 * @typedef {import('./app.js').ComfyApp} ComfyApp
 * @typedef {import('./app.js').ComfyNode} ComfyNode
 * @typedef {import('./comfySdk.js').ComfyUIClient} ComfyUIClient
 *
 * * WebSocket 消息类型
 * @typedef {import('../types/app.js').StatusWebSocketMessageEvent} StatusWebSocketMessageEvent
 * @typedef {import('../types/app.js').ProgressWebSocketMessageEvent} ProgressWebSocketMessageEvent
 * @typedef {import('../types/app.js').ExecutionStartWebSocketMessageEvent} ExecutionStartWebSocketMessageEvent
 * @typedef {import('../types/app.js').ExecutingWebSocketMessageEvent} ExecutingWebSocketMessageEvent
 * @typedef {import('../types/app.js').ExecutedWebSocketMessageEvent} ExecutedWebSocketMessageEvent
 * @typedef {import('../types/app.js').ExecutionErrorWebSocketMessageEvent} ExecutionErrorWebSocketMessageEvent
 * @typedef {import('../types/app.js').ExecutionCachedWebSocketMessageEvent} ExecutionCachedWebSocketMessageEvent
 * @typedef {import('../types/app.js').ExecutionUntrackedWebSocketMessageEvent} ExecutionUntrackedWebSocketMessageEvent
 * @typedef {import('../types/app.js').ExecutionFinishedWebSocketMessageEvent} ExecutionFinishedWebSocketMessageEvent
 * @typedef {import('../types/app.js').ExecutionInterruptedWebSocketMessageEvent} ExecutionInterruptedWebSocketMessageEvent
 *
 * @typedef {import('../types/app.js').QueuePromptInfo} QueuePromptInfo
 */

import { api } from './api.js';
import { roundToDecimalPlaces } from './utils.js';

/**
 * 工作流执行状态
 * @enum {ExecuteStatus} ExecuteStatus
 * @property {string} UNKNOWN 未知
 * @property {string} RUNNING 运行中
 * @property {string} FINISHED 完成
 * @property {string} ERROR 错误
 * @property {string} PENDING 排队中
 */
export const ExecuteStatus = {
  UNKNOWN: 'UNKNOWN',
  RUNNING: 'RUNNING',
  FINISHED: 'FINISHED',
  ERROR: 'ERROR',
  PENDING: 'PENDING',
};
/**
 * 节点执行状态
 * @enum {NodeStatus} NodeStatus
 * @property {string} UNKNOWN 未知
 * @property {string} RUNNING 运行中
 * @property {string} FINISHED 完成
 * @property {string} ERROR 错误
 */
const NodeStatus = {
  UNKNOWN: 'UNKNOWN',
  RUNNING: 'RUNNING',
  FINISHED: 'FINISHED',
  ERROR: 'ERROR',
};
/**
 * 工作流运行错误码
 * @enum {ExecuteErrorCode} ExecuteErrorCode
 * @property {string} UNKNOWN 未知
 * @property {string} SERVER_TIMEOUT 服务器超时中断
 * @property {string} UNTRACKED 执行结果没有被三方服务收录
 * @property {string} EXEC_FAILED 节点执行失败
 */
const ExecuteErrorCode = {
  UNKNOWN: 'UNKNOWN',
  EXEC_FAILED: 'EXEC_FAILED',
  UNTRACKED: 'UNTRACKED',
  SERVER_TIMEOUT: 'SERVER_TIMEOUT',
};

/**
 * Comfy Socket 消息处理
 * 主要负责向外层分发消息
 * @class ComfySocketMessage
 * @property {ComfyApp} app
 * @property {ComfyUIClient} comfySdk
 * @method setup
 * @method destroy
 */
export class ComfySocketMessage {
  /**
   * ComfySocketMessage 实例
   */
  static instance = null;
  /**
   * @type {ComfyApp}
   */
  app;
  /**
   * @type {ComfyUIClient}
   */
  comfySdk;
  /**
   * 是否已经初始化
   * @private
   *
   * @type {boolean}
   */
  #alreadySetup = false;
  /**
   * 当前执行状态
   * @private
   *
   * @type {ExecuteStatus}
   */
  #executeStatus = ExecuteStatus.UNKNOWN;
  /**
   * 当前执行的工作流的节点状态
   * @private
   *
   * @type {Record<string, NodeStatus>}
   */
  #executePromptNodesStatus = {};

  /**
   * @param {ComfyApp} app
   */
  constructor(app) {
    if (ComfySocketMessage.instance) {
      return ComfySocketMessage.instance;
    }

    this.app = app;
    this.comfySdk = app.comfySdk;
    ComfySocketMessage.instance = this;
  }

  /**
   * 注册 WebSocket 消息监听
   */
  setup() {
    if (this.#alreadySetup) {
      console.warn('===>> [socketMessage.js] already setup!');
      return;
    }
    this.#alreadySetup = true;
    this.clearState();

    /**
     * 队列状态消息
     */
    api.addEventListener('status', this.#handleStatus.bind(this));
    /**
     * 工作流节点执行进度消息
     */
    api.addEventListener('progress', this.#handleProgress.bind(this));
    /**
     * 正在执行的工作流节点消息
     * @description 当工作流整个完成时，`event.detail`为 null,
     *              且工作流整个完成的事件会在 status 事件后收到
     */
    api.addEventListener('executing', this.#handleExecuting.bind(this));
    /**
     * 已执行的工作流节点消息
     */
    api.addEventListener('executed', this.#handleExecuted.bind(this));
    /**
     * 工作流开始执行消息
     */
    api.addEventListener(
      'execution_start',
      this.#handleExecutionStart.bind(this),
    );
    // 工作流执行出错
    api.addEventListener(
      'execution_error',
      this.#handleExecutionError.bind(this),
    );
    // 工作流部分节点命中缓存的执行结果
    api.addEventListener(
      'execution_cached',
      this.#handleExecutionCached.bind(this),
    );
    // 流程执行成功，但结果未被正确记录到第三方后端
    api.addEventListener(
      'execution_untracked',
      this.#handleExecutionUntracked.bind(this),
    );
    // 流程执行成功，结果正确记录到第三方后端
    // 从websocket消息队列来看，要早于 executing 事件的节点为null 的情况
    // 但 execution 的节点为null时，可能存在执行出现错误的情况，因此依然以此方式处理
    api.addEventListener(
      'execution_finished',
      this.#handleExecutionFinished.bind(this),
    );
    api.addEventListener(
      'execution_interrupted',
      this.#handleExecutionInterrupted.bind(this),
    );
  }
  /**
   * 销毁 WebSocket 消息监听
   */
  destroy() {
    api.removeEventListener('status', this.#handleStatus.bind(this));
    api.removeEventListener('progress', this.#handleProgress.bind(this));
    api.removeEventListener('executing', this.#handleExecuting.bind(this));
    api.removeEventListener('executed', this.#handleExecuted.bind(this));
    api.removeEventListener(
      'execution_start',
      this.#handleExecutionStart.bind(this),
    );
    api.removeEventListener(
      'execution_error',
      this.#handleExecutionError.bind(this),
    );
    api.removeEventListener(
      'execution_cached',
      this.#handleExecutionCached.bind(this),
    );
    api.removeEventListener(
      'execution_untracked',
      this.#handleExecutionUntracked.bind(this),
    );
    api.removeEventListener(
      'execution_finished',
      this.#handleExecutionFinished.bind(this),
    );
    api.removeEventListener(
      'execution_interrupted',
      this.#handleExecutionInterrupted.bind(this),
    );
  }
  /**
   * 清空状态
   */
  clearState() {
    this.#executeStatus = ExecuteStatus.UNKNOWN;
    this.#executePromptNodesStatus = {};
  }
  /**
   * 获取当前执行状态
   * @returns {ExecuteStatus}
   */
  getExecuteStatus() {
    return this.#executeStatus;
  }

  /**
   * 获取当前排队位置
   * @param {QueuePromptInfo[]} runningQueues
   * @param {QueuePromptInfo[]} pendingQueues
   *
   * @returns {{
   *  current: number;
   *  total: number;
   *  currentPrompt: QueuePromptInfo | undefined;
   * }}
   */
  #findQueueIndex(runningQueues, pendingQueues) {
    const totalQueues = [...runningQueues, ...pendingQueues];
    const queueIndex = totalQueues.findIndex(
      (item) => item.prompt[1] === this.comfySdk.currentPromptId,
    );

    // 在运行队列中，且排在第一位
    // 但还没有收到 'execution_start' 消息
    // 因此需要将队列索引加一
    if (queueIndex === 0 && this.#executeStatus === ExecuteStatus.PENDING) {
      queueIndex += 1;
    }

    return {
      current: queueIndex,
      total: totalQueues.length,
      currentPrompt: totalQueues[queueIndex],
    };
  }

  /**
   * 处理队列状态
   * @param {StatusWebSocketMessageEvent} event
   */
  async #handleStatus(event) {
    // 如果当前用户没有队列信息，不处理
    if (
      !this.comfySdk.currentPromptId ||
      !this.comfySdk.currentPromptNodeIds.length
    ) {
      return;
    }

    // 如果当前状态不是 UNKNOWN 或 PENDING，不处理
    if (
      ![ExecuteStatus.UNKNOWN, ExecuteStatus.PENDING].includes(
        this.#executeStatus,
      )
    ) {
      return;
    }

    this.clearState();
    this.#executePromptNodesStatus = this.comfySdk.currentPromptNodeIds.reduce(
      (prev, key) => {
        prev[key] = NodeStatus.PENDING;
        return prev;
      },
      {},
    );

    try {
      const { Running, Pending } = await api.getQueue();
      console.log(
        '===>> [socketMessage.js] processExecuteQueue Running: ',
        Running,
      );
      console.log(
        '===>> [socketMessage.js] processExecuteQueue Pending: ',
        Pending,
      );

      const { current, total, currentPrompt } = this.#findQueueIndex(
        Running,
        Pending,
      );

      // 如果不在队列中，不处理
      if (current === 0 || !currentPrompt) {
        return;
      }

      this.#dispatchExecuteQueue({
        current,
        total,
      });
    } catch (error) {
      console.error('===>> [socketMessage.js] processExecuteQueue', error);
    }
  }
  /**
   * 处理工作流节点执行进度
   * @param {ProgressWebSocketMessageEvent} event
   */
  #handleProgress(event) {
    console.log('===>> [socketMessage.js] handleProgress', event);
    const { value, max, node: currentNodeId, prompt_id } = event.detail;
    if (prompt_id !== this.comfySdk.currentPromptId) return;

    const nodeProgress = Math.max(0, Math.min(1, value / max));
    const progress = this.#calculateProgress(nodeProgress);

    this.#executePromptNodesStatus[currentNodeId] =
      nodeProgress === 1 ? NodeStatus.FINISHED : NodeStatus.RUNNING;
    this.#dispatchExecuteProgress({
      progress,
    });
  }
  /**
   * 处理正在执行的工作流节点
   * @param {ExecutingWebSocketMessageEvent} event
   */
  #handleExecuting(event) {
    console.log('===>> [socketMessage.js] handleExecuting', event);
    const { node: currentNodeId, prompt_id } = event.detail;
    if (prompt_id !== this.comfySdk.currentPromptId) return;

    // 当 currentNodeId 为 null 时，表示整个流程已经执行完成
    // 不知道是执行成功还是执行失败
    // 所以只标记为 FINISHED
    if (!currentNodeId) {
      this.#dispatchExecuteProgress({
        progress: 100,
      });
      return;
    }

    const progress = this.#calculateProgress();
    this.#executePromptNodesStatus[currentNodeId] = NodeStatus.RUNNING;

    this.#dispatchExecuteProgress({
      progress,
    });
  }
  /**
   * 处理已执行的工作流节点
   * @param {ExecutedWebSocketMessageEvent} event
   */
  #handleExecuted(event) {
    console.log('===>> [socketMessage.js] handleExecuted', event);
    const { node: currentNodeId, prompt_id } = event.detail;
    if (prompt_id !== this.comfySdk.currentPromptId) return;

    const progress = this.#calculateProgress();

    this.#executePromptNodesStatus[currentNodeId] = NodeStatus.FINISHED;
    this.#dispatchExecuteProgress({
      progress,
    });
  }
  /**
   * 处理工作流开始执行
   * @param {ExecutionStartWebSocketMessageEvent} event
   */
  #handleExecutionStart(event) {
    console.log('===>> [socketMessage.js] handleExecutionStart', event);
    const { prompt_id: currentPromptId } = event.detail;
    if (currentPromptId !== this.comfySdk.currentPromptId) return;

    this.#dispatchExecuteStart();
    this.#dispatchExecuteProgress({
      progress: 0,
    });
  }
  /**
   * 处理工作流执行出错
   * @param {ExecutionErrorWebSocketMessageEvent} event
   */
  #handleExecutionError(event) {
    console.log('===>> [socketMessage.js] handleExecutionError', event);
    const { node_id: currentNodeId, prompt_id } = event.detail;
    if (prompt_id !== this.comfySdk.currentPromptId) return;

    this.#executePromptNodesStatus[currentNodeId] = NodeStatus.ERROR;
    this.#dispatchExecuteError(ExecuteErrorCode.EXEC_FAILED, event.detail);
  }
  /**
   * 处理工作流部分节点命中缓存的执行结果
   * @param {ExecutionCachedWebSocketMessageEvent} event
   */
  #handleExecutionCached(event) {
    console.log('===>> [socketMessage.js] handleExecutionCached', event);
    const { nodes: cachedNodeIds, prompt_id } = event.detail;
    if (prompt_id !== this.comfySdk.currentPromptId) return;

    cachedNodeIds.forEach((nodeId) => {
      this.#executePromptNodesStatus[nodeId] = NodeStatus.FINISHED;
    });
    this.#dispatchExecuteProgress({
      progress: this.#calculateProgress(),
    });
  }
  /**
   * 处理工作流执行成功，但结果未被正确记录到第三方后端
   * @param {ExecutionUntrackedWebSocketMessageEvent} event
   */
  #handleExecutionUntracked(event) {
    console.log('===>> [socketMessage.js] handleExecutionUntracked', event);
    const { execution_message, prompt_id } = event.detail;
    if (prompt_id !== this.comfySdk.currentPromptId) return;

    this.#dispatchExecuteError(ExecuteErrorCode.UNTRACKED, execution_message);
  }
  /**
   * 处理工作流执行成功，结果正确记录到第三方后端
   * @param {ExecutionFinishedWebSocketMessageEvent} event
   */
  #handleExecutionFinished(event) {
    console.log('===>> [socketMessage.js] handleExecutionFinished', event);
    const { prompt_id } = event.detail;
    if (prompt_id !== this.comfySdk.currentPromptId) return;

    this.#dispatchExecuteProgress({
      progress: 100,
    });
    this.#dispatchExecuteComplete();
  }

  /**
   * 处理工作流执行中断
   * @param {ExecutionInterruptedWebSocketMessageEvent} event
   */
  #handleExecutionInterrupted(event) {
    console.log('===>> [socketMessage.js] handleExecutionInterrupted', event);
    const { prompt_id, ...restErrorInfo } = event.detail;

    if (prompt_id !== this.comfySdk.currentPromptId) return;
    this.#dispatchExecuteError(ExecuteErrorCode.SERVER_TIMEOUT, restErrorInfo);
  }

  /**
   * 计算工作流节点执行进度
   *
   * @param {number | number[] | undefined} [nodeProgress] 单个节点的进度信息
   *
   * @returns {number}
   */
  #calculateProgress(nodeProgress) {
    const nodeIds = Object.keys(this.#executePromptNodesStatus);
    const pendingNodeIds = nodeIds.filter(
      (nodeId) => this.#executePromptNodesStatus[nodeId] === NodeStatus.PENDING,
    );
    console.log('===>> [socketMessage.js] calculateProgress', {
      nodeStatus: JSON.parse(JSON.stringify(this.#executePromptNodesStatus)),
      nodeIds,
      pendingNodeIds,
      nodeProgress,
    });
    let progress = (nodeIds.length - pendingNodeIds.length) / nodeIds.length;

    // 单个节点占总节点的比例
    if (nodeProgress) {
      if (!Array.isArray(nodeProgress)) {
        nodeProgress = [nodeProgress];
      }

      const singleProgress = 1 / nodeIds.length;
      progress -= singleProgress * nodeProgress.length;
      nodeProgress.forEach((item) => {
        progress += item * singleProgress;
      });
    }

    progress = roundToDecimalPlaces(progress * 100, 2);
    return progress;
  }

  /**
   * 发送队列状态
   * @param {object} data
   * @param {number} data.current 当前队列位置
   * @param {number} data.total 总队列数量
   */
  #dispatchExecuteQueue({ current, total }) {
    this.#executeStatus = ExecuteStatus.PENDING;
    this.comfySdk.emitEvent('queueChanged', {
      promptId: this.comfySdk.currentPromptId,
      current,
      total,
    });
  }
  /**
   * 发送工作流开始执行
   */
  #dispatchExecuteStart() {
    this.#executeStatus = ExecuteStatus.RUNNING;
    this.comfySdk.emitEvent('executeStart', {
      promptId: this.comfySdk.currentPromptId,
    });
  }
  /**
   * 发送工作流节点执行进度
   * @param {object} data
   * @param {number} data.progress 进度
   */
  #dispatchExecuteProgress({ progress }) {
    this.#executeStatus = ExecuteStatus.RUNNING;
    this.comfySdk.emitEvent('executeProgress', {
      promptId: this.comfySdk.currentPromptId,
      progress,
    });
  }
  /**
   * 发送工作流节点执行完成
   */
  #dispatchExecuteComplete() {
    this.#executeStatus = ExecuteStatus.FINISHED;
    this.comfySdk.emitEvent('executeComplete', {
      promptId: this.comfySdk.currentPromptId,
    });
    this.comfySdk.clearState();
  }
  /**
   * 发送工作流节点执行错误
   * @param {ExecutionErrorWebSocketMessageEvent['detail'] | ExecutionUntrackedWebSocketMessageEvent['detail']['execution_message']} error 错误信息
   */
  #dispatchExecuteError(errorCode, error) {
    this.#executeStatus = ExecuteStatus.ERROR;
    this.comfySdk.emitEvent('executeError', {
      promptId: this.comfySdk.currentPromptId,
      errorCode,
      error,
    });
    this.comfySdk.clearState();
  }
}
