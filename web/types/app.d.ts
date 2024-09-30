export interface ValidateError {
  message: string;
  node_errors: Record<
    string,
    {
      class_type: string;
      errors: {
        message: string;
        details: string;
      }[];
    }
  >;
}

/**
 * WebSocket status 消息事件
 */
export interface StatusWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 执行队列信息
     */
    exec_info: {
      /**
       * 剩余队列数量
       */
      queue_remaining: number;
    };
  };
}

/**
 * WebSocket progress 消息事件
 */
export interface ProgressWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
    /**
     * 当前进度
     */
    value: number;
    /**
     * 总进度
     */
    max: number;
    /**
     * 当前节点ID
     */
    node: string;
  };
}

/**
 * WebSocket executing 消息事件
 */
export interface ExecutingWebSocketMessageEvent extends CustomEvent {
  /**
   * 当前节点ID
   */
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
    /**
     * 当前节点ID
     */
    node: string;
  };
}

/**
 * Image节点输出结果的图片
 */
export interface ImageOutputNodeItem {
  filename: string;
  subfolder: string;
  type: 'output';
}
/**
 * Image节点输出结果对象
 */
export interface ImageOutputNode {
  images: ExecutedOutputImage[];
}

/**
 * WebSocket executed 消息事件
 */
export interface ExecutedWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
    /**
     * 节点ID
     */
    node: string;
    /**
     * 节点执行结果
     * @description 数据结构以 comfyui websocket 的返回为准
     */
    output: ImageOutputNode | any;
  };
}

/**
 * WebSocket executing_start 消息事件
 */
export interface ExecutionStartWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
  };
}

/**
 * WebSocket execution_error 消息事件
 */
export interface ExecutionErrorWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
    /**
     * 节点ID
     */
    node_id: string;
    /**
     * 节点类型
     */
    node_type: string;
    /**
     * 节点执行结果
     */
    executed: any;
    /**
     * 异常信息
     */
    exception_message: string;
    /**
     * 异常类型
     */
    exception_type: string;
    /**
     * 异常堆栈
     */
    traceback: any;
    /**
     * 当前输入
     */
    current_inputs: any;
    /**
     * 当前输出
     */
    current_outputs: any;
  };
}

/**
 * WebSocket execution_cached 消息事件
 */
export interface ExecutionCachedWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
    /**
     * 使用了缓存数据的节点ID列表
     */
    nodes: string[];
  };
}
/**
 * WebSocket execution_untracked 消息事件
 */
export interface ExecutionUntrackedWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
    /**
     * 错误信息
     */
    execution_message: string;
  };
}

/**
 * WebSocket execution_finished 消息事件
 */
export interface ExecutionFinishedWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
  };
}

export interface ExecutionInterruptedWebSocketMessageEvent extends CustomEvent {
  detail: {
    /**
     * 当前工作流 prompt_id
     */
    prompt_id: string;
    /**
     * 节点ID
     */
    node_id: string;
    /**
     * 节点类型
     */
    node_type: string;
    /**
     * 节点执行结果
     */
    executed: any;
  };
}

/**
 * 队列中的 prompt 信息
 */
export type QueuePromptInfo = [
  queue_number: number,
  prompt_id: string,
  prompt: Record<string, object>,
  extra_data: object,
  output_nodes: string[],
];
