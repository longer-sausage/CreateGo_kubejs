/**
 * @fileoverview Disable all player item crafting and workbench features.
 * @fileoverview 禁用所有玩家物品合成与工作台功能。
 * @author CreateGo
 */

// Listen to recipe loading event to remove all crafting recipes.
// 监听配方加载事件以移除所有合成配方。
ServerEvents.recipes(event => {
    // Remove all shaped crafting recipes.
    // 移除所有有轨（成型）合成配方。
    event.remove({ type: 'minecraft:crafting_shaped' })

    // Remove all shapeless crafting recipes.
    // 移除所有无轨（无序）合成配方。
    event.remove({ type: 'minecraft:crafting_shapeless' })
})

// Listen to item crafted event as a fallback safety measure.
// 监听物品合成事件作为安全兜底措施。
ItemEvents.crafted(event => {
    // Clear the crafted item output.
    // 清空合成输出物品。
    event.item.count = 0
    if (event.player) {
        event.player.setStatusMessage(Text.red('禁止合成物品！'))
    }
})
