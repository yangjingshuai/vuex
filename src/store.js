import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    /*
     * 第1步 环境判断
     */
    // vuex 的工作的必要条件:
    // 1、已经执行安装函数进行装载
    // 2、支持 Promise 语法（后面解释为什么）
    assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
    assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
    // tip: 查看一下 vuex 的 assert 断言函数

    /* 
     * 第2步 数据初始化、module 树的构造
     */
    // 根据 new 构造传图的 options 或者默认值来初始化内部数据
    const {
      plugins = [],
      strict = false
    } = options

    let {
      state = {}
    } = options
    // 这里有一个简单的小细节，在其他文件里面也会提到，有时候传入的 state 是一个简单的对象，也有可能是一个函数，如果是函数，一般会返回所需要的 state 对象，这个理解起来也比较简单
    if (typeof state === 'function') {
      state = state()
    }

    // 这里面可以分个组：
    // _committing  是否在进行提交状态标识（这个值其实是和 strict 设置紧密相关的）
    // _subscribers   插件（订阅函数）合集
    // _modules modules就是 store 分模块的集合、namespagemap 是模块命名空间 map
    // _actions\_mutations\wrappedGetters\_modulesNamespaceMap   封装后的actions\mutations\getters\modules合集
    // _watcherVM 这里实例化了一个 Vue 组件，具体的功能后面会讲(Vuex其实构建的就是一个名为store的vm组件，所有配置的state、actions、mutations以及getters都是其组件的属性，所有的操作都是对这个vm组件进行的)

    this._committing = false
    this._actions = Object.create(null)
    this._mutations = Object.create(null)
    this._wrappedGetters = Object.create(null)
    // 2.1 介绍下 ModuleCollection 结构
    // 实例化ModuleCollection的时候也给他传入了options的对象，我们先看一个网上的案例，大概了解下一些比较常见的情况下 options 的数据格式是什么样的
    // 不看也可以，其实和现在我们项目里面用的差不多，比较需要注意的是namespaced一般要手动设置为 true(每一层)
    this._modules = new ModuleCollection(options)
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = []
    this._watcherVM = new Vue()

    /* 
     * 第3步 设置 dispatch、commit
     */
    const store = this
    const { dispatch, commit } = this
    // es6的类并不会自动给我们绑定 this 到当前实例对象。实例的属性除非显式定义在其本身（即定义在this对象上），否则都是定义在原型上（即定义在class上）
    // 写多了 React 的同学应该会有比较深的感触
    // 我们可以先简单解释这两个方法，有部分内容会牵扯到后面的部分，就存疑
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // 不要忽略这个小东西
    // strict mode
    this.strict = strict

    /*
     * 第4步 安装 module 初始化rootState
     * 初始化组件树根组件、注册所有子组件，讲其中所有的 getters 存储到this._wrappedGetters属性中
     * 问题是_modules不是已经都注册定义好了么，这里还要安装干嘛呢?
     * 每一个 modules 里面不是已经都有自己的getters/actions/mutations了吗
     */
    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], this._modules.root)

    /*
     * 第5步 store_.vm组件设置
     * Vuex构建了一个名为 store 的 vm 组件，所有配置的 state、actions、mutations、getters 都是这个组件的属性，所有的操作都是针对这个 vm 组件进行的
     */
    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreVM(this, state)

    /*
     * 第6步 plugin注入
     */
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
  // 参数分析先看 dispatch，这里的 commit 就读了一个 options 参数
  // 提交载荷（Payload）
  // store.commit('increment', 10)
  // store.commit('increment', {
  //   amount: 10
  // })
  //
  // 对象风格的提交方式
  // store.commit({
  //   type: 'increment',
  //   amount: 10
  // })

  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    // 3.1.1 这里可以关注一下_mutations的结构、怎样回调，同样的道理，所有的 mutations 已经都做了 key-value 对应
    const entry = this._mutations[type]
    if (!entry) {
      console.error(`[vuex] unknown mutation type: ${type}`)
      return
    }
    // 3.1.2 这里可以关注一下_withCommit
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
        // 这个方法就是之后定义的 wrappedMutationHandler(handler)，执行它就相当于执行了 registerMutation 注册的回调函数
        // 这里会回答为什么第一个参数可以拿到 state，但是这里的 local 是什么鬼呢？
      })
    })

    /* !钩子
      const entry = store._mutations[type] || (store._mutations[type] = [])
      entry.push(function wrappedMutationHandler (payload) {
        handler(local.state, payload)
      })
    */



    // 3.1.3 给插件传入回掉
    this._subscribers.forEach(sub => sub(mutation, this.state))

    // !!! 这个配置我还没跟踪
    if (options && options.silent) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  // 3.2 了解dispatch
  // type 表示 action 的类型，payload 表示额外的参数
  // dispatch的功能是触发并传递一些参数（payload）给对应type的action
  // 因为其支持2种调用方法，所以在dispatch中，先进行参数的适配处理(这个地方不需要深究，以免增加理解复杂度)
  // 以载荷形式分发
  // store.dispatch('incrementAsync', {
  //   amount: 10
  // })
  //
  // 以对象形式分发
  // store.dispatch({
  //   type: 'incrementAsync',
  //   amount: 10
  // })

  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    // 3.2.1 这里可以关注一下_actions
    // 同时你也可以想象一下，外部调用 dispatch 的时候传入一个 type 作为 key，而this._actions里面保存了所有注册的__actions，那是否保存了嵌套的actions呢？ !!!
    const entry = this._actions[type]
    if (!entry) {
      console.error(`[vuex] unknown action type: ${type}`)
      return
    }
    // 它对 action 的对象数组长度做判断，如果长度为 1 则直接调用 entry[0](payload)
    // 这个方法就是之前定义的 wrappedActionHandler(payload, cb)，执行它就相当于执行了 registerAction 注册的回调函数，并把当前模块的 context 和 额外参数 payload 作为参数传入。所以我们在 action 的回调函数里，可以拿到当前模块的上下文包括 store 的 commit 和 dispatch 方法、getter、当前模块的 state 和 rootState。   !!!
    return entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)
    // 这里先存疑，你先理解触发一个dispatch的时候会到Store 实例的_actions中找到对应注册的那个/那些方法，然后传递给他payload
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
    // 唯一调用modules的 update 功能的地方
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  // 修改 state，因为我们规定 commit 是同步方法，这里_committing的值设置就有一定的作用。在修改过程中_committing设置为 true
  // 这里去看一下enableStrictModle方法
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
  //
  // 这里注意一下wrappedGetters的函数定义结构
  // function wrappedGetter(store) {
  //  return rawGetter(
  //    local.state,
  //    loca.getters,
  //    store.state,
  //    store.getters
  //  )
  // }
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store)
    // 这里 computed 其实也挺蛋疼的，大家需要适应函数式编程
    // 下面这句话正式定义了getters
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  /*
   *Object.defineProperty方法为getters对象建立属性，使得我们通过this.$store.getters.xxxgetter能够访问到该getters
   * 因为它已经在下面通过computed传递进入了_vm
   */

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  // 设置 silent 为 true 的目的是为了取消这个 _vm 的所有日志和警告
  const silent = Vue.config.silent
  Vue.config.silent = true
  // 直接访问this.$store.state.XXX的时候其实是在访问this.$store._vm._data.$$state.XXX
  // 访问this.$store.getters.XXX的时候。。。 

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
  // 根节点就是 ''，在设置了namespaced为 true 的情况下，子节点的 namespace 将会分别是'xx/xx'
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  // 递归注册每一层的 module 的时候，建立了一个map
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // 不为根且非热更新的情况，设置级联状态,先看后面的部分
  // 形成了 modules 外的 state 树
  if (!isRoot && !hot) {
    // getNestedState方法会拿到该 module 的父级 state
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 定义local变量和module.context的值
  // 执行makeLocalContext方法，为该module设置局部的 dispatch、commit方法以及getters和state
  // 请注意这里的三个变量store 就是实例对象，namespace 你可以认为是一个key、path 是路径，还没看 makeLocalContext 之前会比较疑惑这里为什么会同时传递这两个参数，因为 namespace 是从 path 计算出来的。
  const local = module.context = makeLocalContext(store, namespace, path)

  // 请注意这里没有forEachState
  // 还记得 state 在哪儿设置的吗？
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
  // 还记得dispatch和 commit 是绑定到 Store 实例的，所以这里的 dispatch、commit 的this 对象
  const local = {

    // 我们使用的时候对于根节点，会直接调用store.dispatch
    // 对于子节点，其实也是一样的，只不过命名空间的处理有点绕。其实也很简单，结果就是，大家（每个 module.context对象）都会有自己的局部dispatch\commit\getters\state why
    // 下面之所有用一个三目，主要还是为了验证是不是存在这个action/mutation
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
    // 根节点的getters就是Store上面的 getters
    // 子节点会做一个local获取，原理比较简单，但是和下面的问题一样store.getters是什么时候建立起来的
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    // state 会根据路径做一个获取
    // 提问：state这里是获取，那还记得 state 是从哪儿建立起整个树的吗？
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  // 每个 module 有了自己的commit\dispatch\getters\state方法
  return local
}

function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  // namespace的最后一位是'/'，这里做了
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
// registerMutation(store, namespacedType, mutation, local)
// registerMutation(store, namespacedType, module.mutations[xxx], module.context)
// 这里的 push 标明，同一个名的 mutations 可以注册多个回掉
// !钩子
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler(local.state, payload)
  })
}

// 通力，但是参数更加丰富
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

// 这个返回比较简单,记住参数是一个函数，返回函数的参数分别是local和 store 的state和getters
// 这里有个比较蛋疼的事情，为什么别人都用_actions，而 getters 用的是_wrappedGetters这个属性名呢？思考下，废话，getters 被占用了，那怎么就被占用了呢？？？
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
// 保证state状态的修改处于统一管理监控
// 严格模式的资源占用比较多，所以上线会关闭
// 请注意这里用到了$watch，监听的是this._data.$$state。这些是什么呢？!!!
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
