/**
 * Implements the server-authoritative CreateGo currency wallet.
 * 实现由服务端权威管理的 CreateGo 货币钱包。
 *
 * Author: CreateGo
 * Date: 2026-08-04
 */

const WALLET_TITLE = Text.of('钱包')
const WALLET_BALANCE_PREFIX = 'CreateGoWalletBalance_'
const WALLET_SESSION_PREFIX = 'CreateGoWalletSession_'
const MAX_WALLET_BALANCE = 2147483647
const INVENTORY_SLOT_COUNT = 36
const EMPTY_STACK = Item.of('minecraft:air')

const CURRENCIES = [
  { id: 'creatego:coin_copper', name: '铜币', value: 1, x: 3, color: '§6' },
  { id: 'creatego:coin_silver', name: '银币', value: 100, x: 4, color: '§7' },
  { id: 'creatego:coin_gold', name: '金币', value: 10000, x: 5, color: '§e' }
]

/**
 * Returns the persistent balance key for a player.
 * 返回玩家的持久化余额键。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @returns {string} balance key / 余额键
 */
function getBalanceKey(player) {
  return WALLET_BALANCE_PREFIX + player.uuid
}

/**
 * Returns the persistent open-session key for a player.
 * 返回玩家的持久化打开会话键。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @returns {string} session key / 会话键
 */
function getSessionKey(player) {
  return WALLET_SESSION_PREFIX + player.uuid
}

/**
 * Reads and validates a player's balance in copper units.
 * 以铜币为最小单位读取并校验玩家余额。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @returns {number} validated balance / 校验后的余额
 */
function getBalance(player) {
  var balance = Number(player.server.persistentData.getLong(getBalanceKey(player)))
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > MAX_WALLET_BALANCE) {
    console.error(`[CreateGo Wallet] [玩家: ${player.username}] 检测到非法余额 ${balance}，已重置为 0`)
    player.server.persistentData.putLong(getBalanceKey(player), 0)
    return 0
  }
  return balance
}

/**
 * Writes a validated balance in copper units.
 * 以铜币为最小单位写入经校验的余额。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {number} balance new balance / 新余额
 */
function setBalance(player, balance) {
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > MAX_WALLET_BALANCE) {
    throw new Error(`Rejected invalid wallet balance: ${balance}`)
  }
  player.server.persistentData.putLong(getBalanceKey(player), balance)
}

/**
 * Marks whether the player's captured inventory needs crash recovery.
 * 标记玩家被捕获的背包是否需要崩溃恢复。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {boolean} open whether the wallet is open / 钱包是否打开
 */
function setSessionOpen(player, open) {
  var data = player.server.persistentData
  var key = getSessionKey(player)
  if (open) {
    data.putBoolean(key, true)
  } else {
    data.remove(key)
  }
}

/**
 * Finds currency metadata for an item stack.
 * 根据物品堆查找货币元数据。
 *
 * @param {Internal.ItemStack} stack item stack / 物品堆
 * @returns {object|null} currency metadata or null / 货币元数据或空值
 */
function findCurrency(stack) {
  if (stack == null || stack.isEmpty()) {
    return null
  }
  var id = String(stack.id)
  for (const currency of CURRENCIES) {
    if (currency.id === id) {
      return currency
    }
  }
  return null
}

/**
 * Creates an immutable visual stack representing one denomination.
 * 创建表示某一币种的不可取走展示物品堆。
 *
 * @param {object} currency currency metadata / 货币元数据
 * @param {number} balance balance in copper units / 铜币单位余额
 * @returns {Internal.ItemStack} display stack / 展示物品堆
 */
function createDisplayStack(currency, balance) {
  var amount = Math.floor(balance / currency.value)
  var visualCount = Math.max(1, amount)
  return Item.of(currency.id, visualCount)
    .withCustomName(Text.of(`${currency.color}${currency.name}：${amount}`))
    .withLore([
      Text.of(`§7总价值：${balance} 铜币`),
      Text.of('§8左键取出最多 64 枚，右键取出 1 枚'),
      Text.of('§8点击背包中的硬币可存入')
    ])
}

/**
 * Refreshes all three denomination views from the single balance.
 * 根据唯一余额实时刷新三个币种视图。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {Internal.ChestMenuData} gui wallet GUI / 钱包界面
 */
function refreshWallet(player, gui) {
  var balance = getBalance(player)
  for (const currency of CURRENCIES) {
    gui.getSlot(currency.x, 0).setItem(createDisplayStack(currency, balance))
  }
}

/**
 * Broadcasts the current custom menu after intercepted player-slot clicks.
 * 在拦截玩家背包格点击后广播当前自定义菜单。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 */
function syncOpenWallet(player) {
  player.openInventory.broadcastFullState()
}

/**
 * Copies all captured main-inventory stacks for transaction rollback.
 * 复制所有被捕获的主背包物品，用于事务回滚。
 *
 * @param {Internal.Container} inventory captured inventory / 被捕获的背包
 * @returns {Internal.ItemStack[]} inventory snapshot / 背包快照
 */
function snapshotInventory(inventory) {
  var snapshot = []
  for (let slot = 0; slot < INVENTORY_SLOT_COUNT; slot++) {
    snapshot.push(inventory.getItem(slot).copy())
  }
  return snapshot
}

/**
 * Restores a captured inventory from a rollback snapshot.
 * 从回滚快照恢复被捕获的背包。
 *
 * @param {Internal.Container} inventory captured inventory / 被捕获的背包
 * @param {Internal.ItemStack[]} snapshot inventory snapshot / 背包快照
 */
function restoreSnapshot(inventory, snapshot) {
  for (let slot = 0; slot < INVENTORY_SLOT_COUNT; slot++) {
    inventory.setItem(slot, snapshot[slot].copy())
  }
}

/**
 * Replaces KubeJS's recovery entry with the current authoritative inventory.
 * 使用当前权威背包替换 KubeJS 的恢复记录。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {Internal.Container} inventory captured inventory / 被捕获的背包
 */
function syncRecoveryInventory(player, inventory) {
  var recovery = Utils.newMap()
  var recoveryStack = EMPTY_STACK
  for (let slot = 0; slot < INVENTORY_SLOT_COUNT; slot++) {
    recoveryStack = inventory.getItem(slot)
    if (!recoveryStack.isEmpty()) {
      recovery.put(slot, recoveryStack.copy())
    }
  }
  player.server.restoreInventories().put(player.uuid, recovery)
}

/**
 * Runs one wallet mutation with balance and inventory rollback on failure.
 * 运行一次钱包变更，失败时同时回滚余额与背包。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {Internal.ChestMenuData} gui wallet GUI / 钱包界面
 * @param {function(number): (number|null)} mutation inventory mutation returning a new balance / 返回新余额的背包变更
 * @returns {boolean} whether the transaction committed / 事务是否提交
 */
function runTransaction(player, gui, mutation) {
  var oldBalance = getBalance(player)
  var snapshot = snapshotInventory(gui.capturedInventory)
  try {
    var newBalance = mutation(oldBalance)
    if (newBalance == null) {
      return false
    }
    setBalance(player, newBalance)
    syncRecoveryInventory(player, gui.capturedInventory)
    refreshWallet(player, gui)
    syncOpenWallet(player)
    return true
  } catch (error) {
    restoreSnapshot(gui.capturedInventory, snapshot)
    setBalance(player, oldBalance)
    try {
      syncRecoveryInventory(player, gui.capturedInventory)
      refreshWallet(player, gui)
      syncOpenWallet(player)
    } catch (recoveryError) {
      console.error(`[CreateGo Wallet] [玩家: ${player.username}] 事务回滚后同步恢复记录失败: ${recoveryError}`)
    }
    console.error(`[CreateGo Wallet] [玩家: ${player.username}] 钱包事务已回滚: ${error}`)
    return false
  }
}

/**
 * Deposits coins from one captured player-inventory slot.
 * 从被捕获的玩家背包格存入硬币。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {Internal.ChestMenuData} gui wallet GUI / 钱包界面
 * @param {Internal.ChestMenuInventoryClickEvent} click inventory click / 背包点击
 */
function depositFromInventory(player, gui, click) {
  var currency = findCurrency(click.getItem())
  if (currency == null) {
    return
  }

  var clickType = String(click.type)
  var amount = 0
  if (clickType === 'PICKUP') {
    amount = click.button === 1 ? 1 : click.getItem().count
  } else if (clickType === 'QUICK_MOVE') {
    amount = click.getItem().count
  } else {
    return
  }

  runTransaction(player, gui, balance => {
    var addedValue = amount * currency.value
    if (addedValue > MAX_WALLET_BALANCE - balance) {
      console.warn(`[CreateGo Wallet] [玩家: ${player.username}] 存入被拒绝：余额将超过上限`)
      return null
    }
    var remaining = click.getItem().count - amount
    click.setItem(remaining === 0 ? EMPTY_STACK.copy() : click.getItem().copyWithCount(remaining))
    return balance + addedValue
  })
}

/**
 * Withdraws one requested denomination directly into the captured inventory.
 * 将指定数量的某一币种直接取入被捕获的背包。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {Internal.ChestMenuData} gui wallet GUI / 钱包界面
 * @param {object} currency currency metadata / 货币元数据
 * @param {number} requested requested coin count / 请求的硬币数量
 */
function withdrawToInventory(player, gui, currency, requested) {
  runTransaction(player, gui, balance => {
    var available = Math.floor(balance / currency.value)
    var amount = Math.min(requested, available)
    if (amount <= 0) {
      return null
    }

    var output = Item.of(currency.id, amount)
    var simulatedRemainder = gui.capturedInventory.insertItem(output.copy(), true)
    if (!simulatedRemainder.isEmpty()) {
      console.warn(`[CreateGo Wallet] [玩家: ${player.username}] 取出被拒绝：背包空间不足`)
      return null
    }

    var remainder = gui.capturedInventory.insertItem(output, false)
    if (!remainder.isEmpty()) {
      throw new Error(`Inventory insertion left ${remainder.count} unexpected items`)
    }
    return balance - amount * currency.value
  })
}

/**
 * Merges an unexpected real-inventory or cursor stack into captured storage.
 * 将意外出现在真实背包或鼠标上的物品并入捕获存储。
 *
 * @param {Internal.Container} inventory captured inventory / 被捕获的背包
 * @param {Internal.ItemStack} stack stack to merge / 待合并物品堆
 * @param {Internal.ItemStack[]} overflow overflow output / 溢出物品列表
 */
function mergeIntoCaptured(inventory, stack, overflow) {
  if (stack == null || stack.isEmpty()) {
    return
  }
  var remainder = inventory.insertItem(stack.copy(), false)
  if (!remainder.isEmpty()) {
    overflow.push(remainder.copy())
  }
}

/**
 * Restores the authoritative captured inventory when the wallet closes.
 * 在钱包关闭时恢复权威的被捕获背包。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {Internal.ChestMenuData} gui wallet GUI / 钱包界面
 */
function closeWallet(player, gui) {
  try {
    var overflow = []
    var unexpectedStack = EMPTY_STACK

    // Preserve items inserted by commands or other mods while the wallet was open. / 保留钱包打开期间由命令或其他模组放入的物品。
    for (let slot = 0; slot < INVENTORY_SLOT_COUNT; slot++) {
      unexpectedStack = player.inventory.getStackInSlot(slot)
      mergeIntoCaptured(gui.capturedInventory, unexpectedStack, overflow)
      player.inventory.setStackInSlot(slot, EMPTY_STACK.copy())
    }

    // Preserve an unexpected carried stack before clearing the custom menu cursor. / 清空自定义菜单鼠标前保留意外的手持物品堆。
    mergeIntoCaptured(gui.capturedInventory, gui.mouseItem, overflow)
    gui.mouseItem = EMPTY_STACK.copy()
    syncRecoveryInventory(player, gui.capturedInventory)

    for (let slot = 0; slot < INVENTORY_SLOT_COUNT; slot++) {
      player.inventory.setStackInSlot(slot, gui.capturedInventory.getItem(slot).copy())
    }

    for (const stack of overflow) {
      player.give(stack)
    }
    player.server.restoreInventories().remove(player.uuid)
    setSessionOpen(player, false)
    player.sendInventoryUpdate()
    console.info(`[CreateGo Wallet] [玩家: ${player.username}] 钱包已关闭，余额 ${getBalance(player)} 铜币`)
  } catch (error) {
    console.error(`[CreateGo Wallet] [玩家: ${player.username}] 关闭钱包时恢复背包失败，已保留恢复记录: ${error}`)
  }
}

/**
 * Configures one denomination slot without loop-scoped callback bindings.
 * 在不使用循环作用域回调绑定的情况下配置一个币种格。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {Internal.ChestMenuData} gui wallet GUI / 钱包界面
 * @param {object} currency currency metadata / 货币元数据
 */
function configureCurrencySlot(player, gui, currency) {
  var walletSlot = gui.getSlot(currency.x, 0)
  walletSlot.setLeftClicked(() => withdrawToInventory(player, gui, currency, 64))
  walletSlot.setRightClicked(() => withdrawToInventory(player, gui, currency, 1))
  walletSlot.setShiftLeftClicked(() => withdrawToInventory(player, gui, currency, 64))
  walletSlot.setShiftRightClicked(() => withdrawToInventory(player, gui, currency, 1))
}

/**
 * Configures the wallet GUI and all guarded click handlers.
 * 配置钱包界面及所有受保护的点击处理器。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 * @param {Internal.ChestMenuData} gui wallet GUI / 钱包界面
 */
function configureWallet(player, gui) {
  gui.playerSlots = true
  gui.inventoryClicked = click => depositFromInventory(player, gui, click)
  gui.closed = () => closeWallet(player, gui)
  gui.anyClicked = click => click.setHandled()

  configureCurrencySlot(player, gui, CURRENCIES[0])
  configureCurrencySlot(player, gui, CURRENCIES[1])
  configureCurrencySlot(player, gui, CURRENCIES[2])
  refreshWallet(player, gui)
}

/**
 * Opens a wallet and persists its first recovery snapshot immediately.
 * 打开钱包，并立即持久化第一份恢复快照。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 */
function openWallet(player) {
  // Finish a previously interrupted capture before a new GUI can replace its recovery snapshot. / 在新界面覆盖恢复快照前，先完成上一次中断的背包捕获。
  if (player.server.persistentData.getBoolean(getSessionKey(player))) {
    recoverInterruptedSession(player)
    if (player.server.persistentData.getBoolean(getSessionKey(player))) {
      console.error(`[CreateGo Wallet] [玩家: ${player.username}] 旧钱包会话尚未恢复，已拒绝覆盖恢复快照`)
      return
    }
  }

  var gui = null
  player.openChestGUI(WALLET_TITLE, 1, data => {
    gui = data
    configureWallet(player, data)
  })

  try {
    setSessionOpen(player, true)
    syncRecoveryInventory(player, gui.capturedInventory)
    console.info(`[CreateGo Wallet] [玩家: ${player.username}] 钱包已打开，余额 ${getBalance(player)} 铜币`)
  } catch (error) {
    console.error(`[CreateGo Wallet] [玩家: ${player.username}] 创建钱包恢复记录失败: ${error}`)
    player.closeContainer()
  }
}

/**
 * Restores an interrupted wallet session from the shared persistent snapshot.
 * 从共享持久化快照恢复意外中断的钱包会话。
 *
 * @param {Internal.ServerPlayer} player player / 玩家
 */
function recoverInterruptedSession(player) {
  if (!player.server.persistentData.getBoolean(getSessionKey(player))) {
    return
  }

  try {
    var recoveryStore = player.server.restoreInventories()
    var recovery = recoveryStore.get(player.uuid)
    var recoveredSlot = -1

    if (recovery == null) {
      // Never clear a real inventory when the authoritative recovery snapshot is missing. / 权威恢复快照缺失时，绝不清空真实背包。
      setSessionOpen(player, false)
      console.error(`[CreateGo Wallet] [玩家: ${player.username}] 检测到无恢复快照的遗留会话，已保留当前背包并清理会话标记`)
      return
    }

    // The recovery snapshot is authoritative, including the valid empty-inventory case. / 恢复快照是权威数据，其中也包括合法的空背包情况。
    for (let slot = 0; slot < INVENTORY_SLOT_COUNT; slot++) {
      player.inventory.setStackInSlot(slot, EMPTY_STACK.copy())
    }
    for (const entry of recovery.entrySet()) {
      recoveredSlot = Number(entry.getKey().intValue())
      if (recoveredSlot >= 0 && recoveredSlot < INVENTORY_SLOT_COUNT) {
        player.inventory.setStackInSlot(recoveredSlot, entry.getValue().copy())
      }
    }

    recoveryStore.remove(player.uuid)
    setSessionOpen(player, false)
    player.sendInventoryUpdate()
    console.warn(`[CreateGo Wallet] [玩家: ${player.username}] 已恢复意外中断的钱包背包快照`)
  } catch (error) {
    console.error(`[CreateGo Wallet] [玩家: ${player.username}] 恢复意外中断的钱包会话失败: ${error}`)
  }
}

// Register the player wallet command. / 注册玩家钱包命令。
ServerEvents.basicCommand('wallet', event => {
  openWallet(event.player)
})

// Recover crash-interrupted sessions before the player can transact again. / 在玩家再次交易前恢复崩溃中断的会话。
PlayerEvents.loggedIn(event => {
  recoverInterruptedSession(event.player)
})
