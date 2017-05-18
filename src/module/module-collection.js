import Module from './module'
import { forEachValue } from '../util'

// Module 是一个独立的 Module，而 ModuleColection 是一个集合，下面从集合开始说
export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.root = new Module(rawRootModule, false)

    // 注册所有内嵌 modules
    if (rawRootModule.modules) {
      forEachValue(rawRootModule.modules, (rawModule, key) => {
        this.register([key], rawModule, false)
      })
    }
  }

  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  // ModuleCollection的 update，注意区分
  update (rawRootModule) {
    update(this.root, rawRootModule)
  }

  register (path, rawModule, runtime = true) {
    const parent = this.get(path.slice(0, -1))
    const newModule = new Module(rawModule, runtime)
    // 注册一个新 module，添加到父module 上，请注意这里一系列对 path 的处理
    // 这是唯一调用 addChild 的地方，也就是一个_module的 _children 在初始化的时候就固定了，之后不会更改
    parent.addChild(path[path.length - 1], newModule)

    // register nested modules
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        // 不断嵌套
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    // 请注意 parent 是怎么找到的
    const key = path[path.length - 1]
    // 这个基本上是唯一提到 runtime 用处的地方，但是又需要注意runtime 为 false 的时候才会顺利删除掉一个 children，一般情况下都删除不了
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}

function update (targetModule, newModule) {
  // update target module
  // 注意更新了哪些属性
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      // 新的 Module 的数据结构需要是原来的字迹
      if (!targetModule.getChild(key)) {
        console.warn(
          `[vuex] trying to add a new module '${key}' on hot reloading, ` +
          'manual reload is needed'
        )
        return
      }
      // 递归嵌套
      update(targetModule.getChild(key), newModule.modules[key])
    }
  }
}
