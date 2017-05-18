import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // 第1步 环境判断
    // vuex 的工作的必要条件:
    // 1、已经执行安装函数进行装载
    // 2、支持 Promise 语法（后面解释为什么）
    assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
    assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
    // tip: 查看一下 vuex 的 assert 断言函数

    const {
      plugins = [],
      strict = false
    } = options

    let {
      state = {}
    } = options
    if (typeof state === 'function') {
      state = state()
    }

    // 第2步 数据初始化、module 树的构造
    // 这里面可以分个组：
    // _committing
    // _subscribers
    // _actions\_mutations\wrappedGetters
    // _modules\_modulesNamespaceMap moduls就是 store 分模块的集合、namespagemap 是模块命名空间 map
    // _watcherVM 这里实例化了一个 Vue 组件

    this._committing = false
    this._actions = Object.create(null)
    this._mutations = Object.create(null)
    this._wrappedGetters = Object.create(null)
    // 2.1 介绍下 ModuleCollection 结构
    this._modules = new ModuleCollection(options)
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = []
    this._watcherVM = new Vue()

    const store = this
    const { dispatch, commit } = this
    // 第3步 设置 dispatch、commit
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    // 第4步 安装 module 初始化rootState
    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], this._modules.root)

    // 第5步 store_.vm组件设置
    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreVM(this, state)

    // 第6步 plugin注入
    // apply plugins
    plugins.concat(devtoolPlugin).forEach(plugin => plugin(this))
  }

  get state () {
    return this._vm._data.$$state
  }

  set state (v) {
    assert(false, `Use store.replaceState() to explicit replace store state.`)
  }

  // 3.1 了解 commit
  // type 表示 mutation 的类型，payload 表示额外的参数，options 表示一些配置
  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    // 3.1.1 这里可以关注一下_mutations的结构、怎样回调
    const entry = this._mutations[type]
    if (!entry) {
      console.error(`[vuex] unknown mutation type: ${type}`)
      return
    }
    // 3.1.2 这里可以关注一下_withCommit
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
        // 这个方法就是之前定义的 wrappedMutationHandler(handler)，执行它就相当于执行了 registerMutation 注册的回调函数
      })
    })
    // 3.1.3 给插件传入回掉
    this._subscribers.forEach(sub => sub(mutation, this.state))

    if (options && options.silent) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  // 3.2 了解dispatch
  // type 表示 action 的类型，payload 表示额外的参数
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    // 3.2.1 这里可以关注一下_actions
    const entry = this._actions[type]
    if (!entry) {
      console.error(`[vuex] unknown action type: ${type}`)
      return
    }
    // 它对 action 的对象数组长度做判断，如果长度为 1 则直接调用 entry[0](payload)， 这个方法就是之前定义的 wrappedActionHandler(payload, cb)，执行它就相当于执行了 registerAction 注册的回调函数，并把当前模块的 context 和 额外参数 payload 作为参数传入。所以我们在 action 的回调函数里，可以拿到当前模块的上下文包括 store 的 commit 和 dispatch 方法、getter、当前模块的 state 和 rootState。
    return entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)
  }

  subscribe (fn) {
    const subs = this._subscribers
    if (subs.indexOf(fn) < 0) {
      subs.push(fn)
    }
    return () => {
      const i = subs.indexOf(fn)
      if (i > -1) {
        subs.splice(i, 1)
      }
    }
  }

  watch (getter, cb, options) {
    assert(typeof getter === 'function', `store.watch only accepts a function.`)
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  // 这是一个黑魔法的触发点
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  // 动态模块注册，流程几乎和初始化一样
  registerModule (path, rawModule) {
    if (typeof path === 'string') path = [path]
    assert(Array.isArray(path), `module path must be a string or an Array.`)
  // 需要注意的是，这个时候因为没有设置runtime，所以动态注册的模块的 runtime 是 true
    this._modules.register(path, rawModule)
    installModule(this, this.state, path, this._modules.get(path))
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  // !!!
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]
    assert(Array.isArray(path), `module path must be a string or an Array.`)
    this._modules.unregister(path)
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

// 重置一个私有的 _vm 对象，它是一个 Vue 的实例。这个 _vm 对象会保留我们的 state 树，以及用计算属性的方式存储了 store 的 getters
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  // 遍历过程中，依次拿到每个 getter 的包装函数，并把这个包装函数执行的结果用 computed 临时变量保存。
  // 接着用 es5 的 Object.defineProperty 方法为 store.getters 定义了 get 方法，也就是当我们在组件中调用this.$store.getters.xxxgetters 这个方法的时候，会访问 store._vm[xxxgetters]
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  // 设置 silent 为 true 的目的是为了取消这个 _vm 的所有日志和警告
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  // 这个函数每次都会创建新的 Vue 实例并赋值到 store._vm 上，那么旧的 _vm 对象的状态设置为 null，并调用 $destroy 方法销毁这个旧的 _vm 对象
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

// 这里是初始化的第4步，其他阶段也会调用
// 初始化的时候调用是这样的
// installModule(this, state, [], this._modules.root)
// 最后一个参数 hot 为true，表示它是一次热更新
//
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length   // []的时候是根 module
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  // !!! namespaced似乎没有地方会使用,api文档也没有涉及
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // 不为根且非热更新的情况，设置级联状态,先看后面的部分
  // 形成了 modules 外的 state 树
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 定义local变量和module.context的值
  // 执行makeLocalContext方法，为该module设置局部的 dispatch、commit方法以及getters和state
  const local = module.context = makeLocalContext(store, namespace, path)

  // 请注意这里没有forEachState
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const namespacedType = namespace + key
    registerAction(store, namespacedType, action, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 递归去注册每一层的module
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  // 这些局部方法本质是调用的外部store方法，但是在有namespace的情况下略作区分
  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (!store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (!store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
      // !!!
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  // 每个 module 有了自己的commit\dispatch\getters\state方法
  return local
}

function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}

// mutations 的每一项是一个数组里面是一个 handler 函数，函数的第一个变量会传递这个 module 的 state，这个 state 是 module 初始化的时候生成的，但是之后要注意修改的时间
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler(local.state, payload)
  })
}

// !!!
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    // 请注意 handler 的第一个参数
    let res = handler({
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

// 这个返回比较简单,记住参数是一个函数，返回函数的参数辨别是local和 store 的state和getters
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    console.error(`[vuex] duplicate getter key: ${type}`)
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// 严格模式监测 store._vm.state 的变化，看看 state 的变化是否通过执行 mutation 的回调函数改变，如果是外部直接修改 state，那么 store._committing 的值为 false，这样就抛出一条错误。
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    assert(store._committing, `Do not mutate vuex store state outside mutation handlers.`)
  }, { deep: true, sync: true })
}

// 根据 path 查找 state 上的嵌套 state
function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}

function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  assert(typeof type === 'string', `Expects string as the type, but found ${typeof type}.`)

  return { type, payload, options }
}

export function install (_Vue) {
  if (Vue) {
    console.error(
      '[vuex] already installed. Vue.use(Vuex) should be called only once.'
    )
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}

// auto install in dist mode
if (typeof window !== 'undefined' && window.Vue) {
  install(window.Vue)
}
