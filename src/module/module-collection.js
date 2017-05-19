import Module from './module'
import { forEachValue } from '../util'

// Module 是一个独立的 Module，而 ModuleColection 是一个集合，下面从集合开始说
// 这部分的看代码顺序：
// 1、ModuleCollection的constructor
// 2、Module 的所有代码
// 3、ModuleCollection 的其他代码
//
// ModuleCollection的作用是将 options 对象整个构造为一个 module 对象，所有的 modules 属性都会进行模块注册最后成功一个完整的组件数。同时还提供 modules 的更替功能。

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

  // 根据路径从根部寻找一个子 module，从这个方法开始莫名其妙地开始绕了
  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  // 获取命名空间的方法，如果设置namespaced为 true，返回的是类似这样的结构XX/YY/ZZ，如果是 false，返回的是'';这个方法之后在外部 installModule 的时候会调用
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
    // 注册一个新 module，添加到父module 上，请注意这里一系列对 path 的处理；runtime 继承父元素的
    // 注意一下子 module 将来的rawModule是来自于父元素的modules的子元素，所以 actions 和父元素没有关系
    const newModule = new Module(rawModule, runtime)
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
    // 注意这里的 get 方法，注意这里的 get 方法，注意这里的 get 方法
    const parent = this.get(path.slice(0, -1))
    // 请注意 parent 是怎么找到的
    const key = path[path.length - 1]
    // 这个基本上是唯一提到 runtime 用处的地方，但是又需要注意runtime 为 false 的时候才会顺利删除掉一个 children，一般情况下都删除不了
    // 什么是一般情况？后面会讲到，创建 store 的时候声明的模块是没办法删除的，而动态注册的那些是可以的
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
      // 新的 Module 的数据结构需要是原来的子集
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
