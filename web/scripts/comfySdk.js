/**
 * @typedef {import('@ali/comfyui').ComfyUIClientBase} ComfyUIClientBase
 * @typedef {import('@ali/comfyui/esm/types.js').Model} IModel
 * @typedef {import('@ali/comfyui/esm/types.js').WorkflowSetData} IWorkflow
 * @typedef {import('../types/litegraph.js').IWidget} IWidget
 * @typedef {import('../types/app.js').ValidateError} ValidateError
 * @typedef {import('../types/app.js').RunStatus} RunStatus
 * @typedef {import('./app.js').ComfyApp} ComfyApp
 * @typedef {import('./app.js').ComfyNode} ComfyNode
 */
import { api } from './api.js';
import { nanoid, serializeWidgetValue } from './utils.js';

/**
 * 节点 widget 模型类型
 * @enum {WidgetModelTypeEnum} WidgetModelTypeEnum
 * @property {string} LORA
 * @property {string} CHECKPOINT
 */
const WidgetModelTypeEnum = {
  LORA: 'lora',
  CHECKPOINT: 'checkpoint',
};

// 需要拦截的节点 widget 名称
const INTERCEPTOR_WIDGET_NAMES = [
  'lora_name',
  'ckpt_name',
  'unet_name',
  'sdxl_model',
  // 'supir_model',
];
// 需要拦截的节点 widget 对应的类型
const WIDGET_NAME_TYPE_MAP = {
  lora_name: WidgetModelTypeEnum.LORA,
  ckpt_name: WidgetModelTypeEnum.CHECKPOINT,
  unet_name: WidgetModelTypeEnum.CHECKPOINT,
  sdxl_model: WidgetModelTypeEnum.CHECKPOINT,
  // supir_model: WidgetModelTypeEnum.CHECKPOINT,
};

/**
 * @extends {ComfyUIClientBase}
 */
export class ComfyUIClient extends comfyui.ComfyUIClientBase {
  /**
   * 当前的工作流
   * @type {IWorkflow | undefined}
   */
  currentWorkflow = undefined;
  /**
   * 当前的运行的工作流`prompt_id`，只有在执行了 `validateWorkflow` 后，才会生成
   * @type {string | undefined}
   */
  currentPromptId = undefined;
  /**
   * 当前的运行的工作流`prompt_id`对应的节点ID列表
   * @type {string[]}
   */
  currentPromptNodeIds = [];

  /**
   * @param {ComfyApp} app
   */
  constructor(app) {
    super();
    this.app = app;
  }

  async setup() {
    // 无权访问
    if (!ComfyUIClient.currentUserToken) {
      this.app.ui.dialog.show('No permission to access!');
    }

    try {
      await api.authenticate(ComfyUIClient.currentUserToken);
    } catch (error) {
      console.error('ComfyUIClient Authtication Error', error);
      this.app.ui.dialog.show(`Authentication Error: ${error.message}`);

      this.emitEvent('error', {
        message: error.message,
      });
    }
  }

  loaded() {
    this.emitEvent('loaded', {
      version: comfyui.version,
    });
  }

  clearState() {
    this.currentPromptId = undefined;
    this.currentPromptNodeIds = [];
  }

  /**
   * 修改底模
   *
   * @param {IWorkflow} data
   * @returns {Promise<void>}
   */
  async setWorkflow({ id, data }) {
    if (!id || !data) {
      throw new Error('Invalid workflow id or data');
    }

    // 内容相同时，无需更新
    if (
      this.currentWorkflow &&
      id === this.currentWorkflow.id &&
      data === this.currentWorkflow.data
    ) {
      return;
    }

    this.currentWorkflow = { id, data };
    // LGraphNode.prototype.configure 内部会处理 _widget_values_map 数据
    this.app.loadGraphData(data);
  }

  /**
   * 获取工作流
   * @returns {Promise<IWorkflow>}
   */
  async getWorkflow() {
    if (!this.currentWorkflow) {
      this.currentWorkflow = { id: nanoid(), data: '' };
    }
    this.currentWorkflow.data = this.app.graph.serialize();

    return this.currentWorkflow;
  }

  /**
   * 运行工作流
   * @param {object} options
   * @param {string} options.promptId 工作流 ID
   * @param {string[]} options.nodeIds 节点 ID列表
   * @param {number} [options.number] 队列中的位置
   * @param {number} [options.batchCount=1] 批量数量
   * @returns {Promise<void>}
   */
  async runWorkflow({ promptId, nodeIds, number, batchCount = 1 } = {}) {
    if (!promptId || !nodeIds || !nodeIds.length) {
      throw new Error('promptId is required!');
    }
    this.currentPromptId = promptId;
    this.currentPromptNodeIds = nodeIds;

    this.app.queuePrompt(number, batchCount);
  }

  /**
   * 校验工作流
   *
   * @returns {Promise<{ promptId: string, [key: string]: any } | ValidateError>}
   */
  async validateWorkflow() {
    if (this.currentPromptId) {
      throw new Error('current workflow is running, please wait!');
    }

    const { prompt_id, ...rest } = await this.app.validatePrompt();
    return { promptId: prompt_id, ...rest };
  }

  /**
   * 处理节点 widget 点击事件
   *
   * @param {IWidget} widget
   * @param {ComfyNode} node
   */
  processNodeWidgetClickHandler(widget, node) {
    // VFI相关、预处理器 不需要弹框
    if (
      node.type.indexOf('VFI') > -1 ||
      node.type.search(/preprocessor/i) > -1 ||
      [
        'CheckpointLoaderNF4',
        'UnetLoaderGGUF',
        'MZ_KolorsUNETLoader',
        'MZ_KolorsUNETLoaderV2',
        'UNETLoader',
      ].includes(node.type)
    ) {
      return;
    }

    if (node.type === 'SUPIR_Upscale' && widget.name === 'supir_model') {
      return;
    }

    const widgetName = INTERCEPTOR_WIDGET_NAMES.find((name) => {
      return (widget.name || '').indexOf(name) > -1;
    });

    if (WIDGET_NAME_TYPE_MAP[widgetName] === WidgetModelTypeEnum.LORA) {
      this.handleChangeLora(widget, node);
      return;
    }

    if (WIDGET_NAME_TYPE_MAP[widgetName] === WidgetModelTypeEnum.CHECKPOINT) {
      this.handleChangeModel(widget, node);
      return;
    }
  }

  /**
   * 更新节点 widget
   *
   * @param {IWidget} widget
   * @param {ComfyNode} node
   * @param {IModel} data
   */
  #updateWidget(widget, node, data) {
    // 展示模型名称
    widget.value = data.name;
    // comfyui内部执行序列化时，需要用到这个函数
    // comfyui原来的widget.value就是真实的数据
    // 但我们展示需要出现模型名称，实际value应当是 `模型版本+模型ID` 的格式
    widget.serializeValue = serializeWidgetValue(data);
    // serializeValueSync 的作用是：当执行`LGraphNode.prototype.serialize`序列化数据时，仅针对当前的 widget进行处理
    // 第三方 widget.serializeValue 可能存在是一个Promise的情况，无法正确判定
    widget.serializeValueSync = widget.serializeValue;
    // 缓存原始数据
    node._widgets_values_map[widget.value] = data;
  }

  /**
   * 修改底模
   *
   * @param {IWidget} widget
   */
  async handleChangeModel(widget, node) {
    try {
      if (!node._widgets_values_map) {
        node._widgets_values_map = {};
      }
      const nextData = await this.changeModel(
        node._widgets_values_map[widget.value],
      );

      this.#updateWidget(widget, node, nextData);
      this.app.graph.setDirtyCanvas(true);
    } catch (error) {
      console.error('ComfyUIClient changeModel Error', error);
    }
  }

  /**
   * 修改 Lora 模型
   *
   * @param {IWidget} widget
   */
  async handleChangeLora(widget, node) {
    try {
      if (!node._widgets_values_map) {
        node._widgets_values_map = {};
      }
      const nextData = await this.changeLora(
        node._widgets_values_map[widget.value],
      );

      this.#updateWidget(widget, node, nextData);
      this.app.graph.setDirtyCanvas(true);
    } catch (error) {
      console.error('ComfyUIClient changeLora Error', error);
    }
  }
}
