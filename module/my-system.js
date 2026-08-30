// Инициализация системы
Hooks.on("init", function() {
  // Регистрация листов актёров и предметов
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("my-system", MyActorSheet, { makeDefault: true });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("my-system", MyItemSheet, { makeDefault: true });
});

// Класс листа актёра
class MyActorSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["my-system", "sheet", "actor"],
      template: "systems/my-system/templates/actor/actor-sheet.html",
      width: 600,
      height: 700,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "main" }]
    });
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Обработка клика по умелости (для броска)
    html.find(".skill-name.rollable").click(this._onSkillRoll.bind(this));
    // Обработка клика по кнопке броска характеристики
    html.find(".roll-characteristic").click(this._onCharacteristicRoll.bind(this));

    // Создание предмета
    html.find(".item-create").click(this._onItemCreate.bind(this));
    // Редактирование предмета (открывает лист предмета)
    html.find(".item-edit").click(this._onItemEdit.bind(this));
    // Удаление предмета
    html.find(".item-delete").click(this._onItemDelete.bind(this));
  }

  // Бросок по умелости
  async _onSkillRoll(event) {
    event.preventDefault();
    const target = event.currentTarget;
    const characteristic = target.dataset.characteristic;
    const skill = target.dataset.skill;
    await this._performRoll(characteristic, skill);
  }

  // Бросок по характеристике (без умелости)
  async _onCharacteristicRoll(event) {
    event.preventDefault();
    const characteristic = event.currentTarget.dataset.characteristic;
    await this._performRoll(characteristic, null);
  }

  // Основная логика броска
  async _performRoll(characteristic, skill = null) {
    const actor = this.actor;
    const system = actor.system;

    // Получаем значение характеристики (буква)
    const charValue = system.characteristics[characteristic];
    if (!charValue) return ui.notifications.error("Характеристика не найдена");

    // Получаем уровень умелости (если указана)
    let skillLevel = 0;
    if (skill) {
      skillLevel = system.skills[characteristic]?.[skill] || 0;
    }

    // Запрашиваем модификатор через диалог
    const modifier = await this._requestModifier();
    if (modifier === undefined) return; // отмена

    // Вычисляем кость характеристики
    const charDie = this._getCharacteristicDie(charValue, skillLevel);

    // Вычисляем кость ситуации
    const situationDie = this._getSituationDie(modifier);

    // Бросаем кости
    const results = [];
    let total = 0;
    if (charDie) {
      const roll = new Roll(charDie).roll();
      results.push(`Кость характеристики (${charDie}): ${roll.total}`);
      total += roll.total;
    }
    if (situationDie) {
      const roll = new Roll(situationDie).roll();
      results.push(`Кость ситуации (${situationDie}): ${roll.total}`);
      total += roll.total;
    }

    // Определяем уровень успеха
    const outcome = this._determineOutcome(total);

    // Формируем сообщение в чат
    const content = `
      <h3>Бросок</h3>
      <p><strong>Характеристика:</strong> ${characteristic} (${charValue})${skill ? `, Умелость: ${skill} (${skillLevel})` : ''}</p>
      <p><strong>Модификатор:</strong> ${modifier}</p>
      <p><strong>Результаты:</strong> ${results.join('<br>')}</p>
      <p><strong>Сумма:</strong> ${total}</p>
      <p><strong>Итог:</strong> ${outcome.label}</p>
    `;
    ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
  }

  // Диалог для ввода модификатора
  _requestModifier() {
    return new Promise((resolve) => {
      new Dialog({
        title: "Модификатор броска",
        content: `
          <p>Выберите модификатор ситуации (-2 … +3):</p>
          <select id="modifier-select">
            <option value="-2">-2</option>
            <option value="-1">-1</option>
            <option value="0" selected>0</option>
            <option value="1">+1</option>
            <option value="2">+2</option>
            <option value="3">+3</option>
          </select>
        `,
        buttons: {
          roll: {
            label: "Бросить",
            callback: (html) => {
              const val = parseInt(html.find("#modifier-select").val(), 10);
              resolve(val);
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => resolve(undefined)
          }
        },
        default: "roll"
      }).render(true);
    });
  }

  // Преобразование буквы характеристики в строку кости с учётом умелости
  _getCharacteristicDie(charValue, skillLevel) {
    const baseMap = { "E": "d4", "D": "d6", "C": "d8", "B": "d10", "A": "d12" };
    // Список граней по возрастанию
    const steps = ["E", "D", "C", "B", "A"];
    let index = steps.indexOf(charValue);
    if (index === -1) index = 1; // default D
    // Повышаем на уровень умелости (макс. A)
    let newIndex = Math.min(index + skillLevel, steps.length - 1);
    const newChar = steps[newIndex];
    return baseMap[newChar] || "d6";
  }

  // Определение кости ситуации по модификатору
  _getSituationDie(modifier) {
    if (modifier === -2) return null; // нет кости
    if (modifier === -1) return "d4";
    if (modifier === 0)  return "d6";
    if (modifier === 1)  return "d8";
    if (modifier === 2)  return "d10";
    if (modifier === 3)  return "d12";
    return "d6"; // fallback
  }

  // Определение исхода по сумме
  _determineOutcome(total) {
    if (total < 2) return { label: "Провал (автоматический)", class: "failure" };
    if (total <= 5) return { label: "Провал с последствиями", class: "failure" };
    if (total <= 9) return { label: "Успех с осложнением", class: "success-complication" };
    if (total <= 14) return { label: "Успех", class: "success" };
    if (total <= 18) return { label: "Успех с плюсом", class: "success-plus" };
    return { label: "Критический успех (+1 опыт)", class: "critical" };
  }

  // Создание предмета
  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.type;
    await this.actor.createEmbeddedDocuments("Item", [{
      name: "Новый предмет",
      type: type,
      system: { description: "" },
      img: "icons/svg/item-bag.svg"
    }]);
  }

  // Редактирование предмета (открываем лист)
  _onItemEdit(event) {
    const li = event.currentTarget.closest(".item");
    const item = this.actor.items.get(li.dataset.itemId);
    if (item) item.sheet.render(true);
  }

  // Удаление предмета
  async _onItemDelete(event) {
    const li = event.currentTarget.closest(".item");
    await this.actor.deleteEmbeddedDocuments("Item", [li.dataset.itemId]);
  }
}

// Класс листа предмета
class MyItemSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["my-system", "sheet", "item"],
      template: "systems/my-system/templates/item/item-sheet.html",
      width: 400,
      height: 400
    });
  }
}