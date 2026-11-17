# Еталон: виміряні значення

Джерело: https://integrity-prototype.vercel.app (макет колеги). Знято `npx tsx scripts/ref-capture.ts`: `getComputedStyle` на 1920x1080, світла тема. Скріншоти еталона лежать у `.ref/` (у git не потрапляють).

## Шрифти (document.fonts, статус loaded)

- Onest 400
- Onest 500
- Onest 600
- Onest 700

Перемикач теми працює: так (data-theme="dark").

## CSS-змінні макета, світла тема

```css
:root {
  --bg: #f6f7f9;
  --panel: #ffffff;
  --soft: #f2f3f5;
  --line: #e8eaee;
  --fg: #111418;
  --muted: #7b818b;
  --faint: #c3c7ce;
  --lime: #9be07a;
  --lime-ink: #10290f;
  --lime-soft: #e8f7df;
  --teal: #1db58f;
  --teal-deep: #2f7d68;
  --teal-soft: #dcf3eb;
  --teal-pale: #c9ead9;
  --amber: #d98f1e;
  --amber-soft: #fbefd9;
  --red: #e0554a;
  --red-soft: #fce5e2;
  --blue: #5a8dee;
  --blue-soft: #e3ecfd;
  --tip: #111418;
  --tip-ink: #ffffff;
  --shadow: 0 1px 2px rgba(17, 20, 24, 0.04), 0 8px 24px rgba(17, 20, 24, 0.06);
  --font: 'Onest', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --r: 16px;
  --r-sm: 10px;
}
```

## CSS-змінні макета, темна тема

```css
:root[data-theme='dark'] {
  --bg: #0d121d;
  --panel: #141a27;
  --soft: #1b2232;
  --line: #242c3d;
  --fg: #eef1f6;
  --muted: #8b93a5;
  --faint: #4b5367;
  --lime: #a8e88a;
  --lime-ink: #0d230d;
  --lime-soft: #1d2f1f;
  --teal: #2cc9a0;
  --teal-deep: #4fae93;
  --teal-soft: #15302a;
  --teal-pale: #1d4a3e;
  --amber: #f0b453;
  --amber-soft: #33281a;
  --red: #f07f75;
  --red-soft: #3a1f1f;
  --blue: #7ea6f5;
  --blue-soft: #1c2740;
  --tip: #eef1f6;
  --tip-ink: #0d121d;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.35);
  color-scheme: dark;
}
```

## Елемент: значення

### Сторінка (body) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(246, 247, 249)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 1920px                                                  |
| height                 | 1080px                                                  |
| _font-variant-numeric  | normal                                                  |
| _text                  | IntegrityIndex                                          |

    ⌘K
    Меню |

### Заголовок h1 (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 22px                                                    |
| font-weight            | 600                                                     |
| line-height            | 31.9px                                                  |
| letter-spacing         | -0.22px                                                 |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 63.9062px                                               |
| height                 | 31.8906px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Огляд                                                   |

### Заголовок картки h2 (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 16px                                                    |
| font-weight            | 600                                                     |
| line-height            | 23.2px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 54px                                                    |
| height                 | 23.1875px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Участь                                                  |

### Підпис-мітка (.lbl) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 13px                                                    |
| font-weight            | 400                                                     |
| line-height            | 18.85px                                                 |
| letter-spacing         | normal                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(123, 129, 139)                                      |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 89px                                                    |
| height                 | 18.8438px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Integrity Index                                         |

### Велике число (.big) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 52px                                                    |
| font-weight            | 600                                                     |
| line-height            | 52px                                                    |
| letter-spacing         | -1.56px                                                 |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 476.812px                                               |
| height                 | 52px                                                    |
| _font-variant-numeric  | tabular-nums                                            |
| _text                  | 49,5                                                    |

### Дробова частина (.dec) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 52px                                                    |
| font-weight            | 600                                                     |
| line-height            | 52px                                                    |
| letter-spacing         | -1.56px                                                 |
| color                  | rgb(195, 199, 206)                                      |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(195, 199, 206)                                      |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | auto                                                    |
| height                 | auto                                                    |
| _font-variant-numeric  | tabular-nums                                            |
| _text                  | ,5                                                      |

### Картка (.card) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(255, 255, 255)                                      |
| border-top-width       | 1px                                                     |
| border-top-color       | rgb(232, 234, 238)                                      |
| border-top-left-radius | 16px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 20px                                                    |
| padding-right          | 20px                                                    |
| padding-bottom         | 20px                                                    |
| padding-left           | 20px                                                    |
| gap                    | normal                                                  |
| width                  | 1063.33px                                               |
| height                 | 253.922px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Integrity IndexДостовірність C                          |

### Сайдбар (.side) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(255, 255, 255)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 22px                                                    |
| padding-right          | 16px                                                    |
| padding-bottom         | 22px                                                    |
| padding-left           | 16px                                                    |
| gap                    | 18px                                                    |
| width                  | 260px                                                   |
| height                 | 1080px                                                  |
| _font-variant-numeric  | normal                                                  |
| _text                  | IntegrityIndex                                          |

    ⌘K
    Меню |

### Бренд (.brand) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 18px                                                    |
| font-weight            | 700                                                     |
| line-height            | 26.1px                                                  |
| letter-spacing         | -0.18px                                                 |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 6px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 6px                                                     |
| gap                    | 10px                                                    |
| width                  | 227px                                                   |
| height                 | 34px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  | IntegrityIndex                                          |

### Логотип-значок (.logo) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 18px                                                    |
| font-weight            | 700                                                     |
| line-height            | 26.1px                                                  |
| letter-spacing         | -0.18px                                                 |
| color                  | rgb(16, 41, 15)                                         |
| background-color       | rgb(155, 224, 122)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(16, 41, 15)                                         |
| border-top-left-radius | 10px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 34px                                                    |
| height                 | 34px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  |                                                         |

### Підпис групи меню (.nav-label) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 11px                                                    |
| font-weight            | 400                                                     |
| line-height            | 15.95px                                                 |
| letter-spacing         | 0.88px                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(123, 129, 139)                                      |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 0px                                                     |
| padding-left           | 10px                                                    |
| gap                    | normal                                                  |
| width                  | 227px                                                   |
| height                 | 15.9375px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Меню                                                    |

### Пункт меню (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 500                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(242, 243, 245)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 12px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 10px                                                    |
| padding-right          | 12px                                                    |
| padding-bottom         | 10px                                                    |
| padding-left           | 12px                                                    |
| gap                    | 12px                                                    |
| width                  | 227px                                                   |
| height                 | 40.2969px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Огляд                                                   |

### Активний пункт меню (.on) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 500                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(242, 243, 245)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 12px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 10px                                                    |
| padding-right          | 12px                                                    |
| padding-bottom         | 10px                                                    |
| padding-left           | 12px                                                    |
| gap                    | 12px                                                    |
| width                  | 227px                                                   |
| height                 | 40.2969px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Огляд                                                   |

### Бейдж-лічильник (.badge) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 11px                                                    |
| font-weight            | 600                                                     |
| line-height            | 15.95px                                                 |
| letter-spacing         | normal                                                  |
| color                  | rgb(224, 85, 74)                                        |
| background-color       | rgb(252, 229, 226)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(224, 85, 74)                                        |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 1px                                                     |
| padding-right          | 7px                                                     |
| padding-bottom         | 1px                                                     |
| padding-left           | 7px                                                     |
| gap                    | normal                                                  |
| width                  | 21px                                                    |
| height                 | 17.9375px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | 5                                                       |

### Картка ролі (.role-card) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(242, 243, 245)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 14px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 12px                                                    |
| padding-right          | 12px                                                    |
| padding-bottom         | 12px                                                    |
| padding-left           | 12px                                                    |
| gap                    | 8px                                                     |
| width                  | 227px                                                   |
| height                 | 86.9219px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Роль                                                    |

          Уповно |

### Селект ролі (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | normal                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(255, 255, 255)                                      |
| border-top-width       | 1px                                                     |
| border-top-color       | rgb(232, 234, 238)                                      |
| border-top-left-radius | 10px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 8px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 8px                                                     |
| padding-left           | 10px                                                    |
| gap                    | normal                                                  |
| width                  | 203px                                                   |
| height                 | 38px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  | Уповноважений                                           |

          Керівн |

### Верхня панель (.top) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | color(srgb 0.964706 0.968627 0.976471 / 0.88)           |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 18px                                                    |
| padding-right          | 28px                                                    |
| padding-bottom         | 18px                                                    |
| padding-left           | 28px                                                    |
| gap                    | 12px                                                    |
| width                  | 1660px                                                  |
| height                 | 74.2969px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Огляд                                                   |

      Синтетичні  |

### Пігулка «Синтетичні дані» (.synthetic) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 11px                                                    |
| font-weight            | 400                                                     |
| line-height            | 15.95px                                                 |
| letter-spacing         | normal                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 1px                                                     |
| border-top-color       | rgb(232, 234, 238)                                      |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 4px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 4px                                                     |
| padding-left           | 10px                                                    |
| gap                    | normal                                                  |
| width                  | 106px                                                   |
| height                 | 25.9375px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Синтетичні дані                                         |

### Кнопка циклу (.pill-btn) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 500                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(255, 255, 255)                                      |
| border-top-width       | 1px                                                     |
| border-top-color       | rgb(232, 234, 238)                                      |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 8px                                                     |
| padding-right          | 14px                                                    |
| padding-bottom         | 8px                                                     |
| padding-left           | 14px                                                    |
| gap                    | 8px                                                     |
| width                  | 145px                                                   |
| height                 | 38.2969px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Цикл 2025-12                                            |

### Круглий перемикач теми (.icon-btn) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(255, 255, 255)                                      |
| border-top-width       | 1px                                                     |
| border-top-color       | rgb(232, 234, 238)                                      |
| border-top-left-radius | 12px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 1px                                                     |
| padding-right          | 6px                                                     |
| padding-bottom         | 1px                                                     |
| padding-left           | 6px                                                     |
| gap                    | normal                                                  |
| width                  | 38px                                                    |
| height                 | 38px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  |                                                         |

### Аватар (.avatar) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 13px                                                    |
| font-weight            | 700                                                     |
| line-height            | 18.85px                                                 |
| letter-spacing         | normal                                                  |
| color                  | rgb(47, 125, 104)                                       |
| background-color       | rgb(220, 243, 235)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(47, 125, 104)                                       |
| border-top-left-radius | 50%                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 38px                                                    |
| height                 | 38px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  | УП                                                      |

### Пошук (.search) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgb(242, 243, 245)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(123, 129, 139)                                      |
| border-top-left-radius | 12px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 9px                                                     |
| padding-right          | 12px                                                    |
| padding-bottom         | 9px                                                     |
| padding-left           | 12px                                                    |
| gap                    | 8px                                                     |
| width                  | 227px                                                   |
| height                 | 40.2969px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | ⌘K                                                      |

### Пігулка статусу (.pill) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 12px                                                    |
| font-weight            | 600                                                     |
| line-height            | 17.4px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(224, 85, 74)                                        |
| background-color       | rgb(252, 229, 226)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(224, 85, 74)                                        |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 4px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 4px                                                     |
| padding-left           | 10px                                                    |
| gap                    | 6px                                                     |
| width                  | 127px                                                   |
| height                 | 25.3906px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Достовірність C                                         |

### Пігулка поганого (.p-bad) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 12px                                                    |
| font-weight            | 600                                                     |
| line-height            | 17.4px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(224, 85, 74)                                        |
| background-color       | rgb(252, 229, 226)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(224, 85, 74)                                        |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 4px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 4px                                                     |
| padding-left           | 10px                                                    |
| gap                    | 6px                                                     |
| width                  | 127px                                                   |
| height                 | 25.3906px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Достовірність C                                         |

### Пігулка доброго (.p-good) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 12px                                                    |
| font-weight            | 600                                                     |
| line-height            | 17.4px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(47, 125, 104)                                       |
| background-color       | rgb(220, 243, 235)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(47, 125, 104)                                       |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 4px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 4px                                                     |
| padding-left           | 10px                                                    |
| gap                    | 6px                                                     |
| width                  | 118px                                                   |
| height                 | 25.3906px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | 3 · Визначений                                          |

### Пігулка попередження (.p-warn) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 12px                                                    |
| font-weight            | 600                                                     |
| line-height            | 17.4px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(217, 143, 30)                                       |
| background-color       | rgb(251, 239, 217)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(217, 143, 30)                                       |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 4px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 4px                                                     |
| padding-left           | 10px                                                    |
| gap                    | 6px                                                     |
| width                  | 126px                                                   |
| height                 | 25.3906px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Потребує уваги                                          |

### Нейтральна пігулка (.p-mute) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 12px                                                    |
| font-weight            | 600                                                     |
| line-height            | 17.4px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgb(242, 243, 245)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(123, 129, 139)                                      |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 4px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 4px                                                     |
| padding-left           | 10px                                                    |
| gap                    | 6px                                                     |
| width                  | 53px                                                    |
| height                 | 25.3906px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | k = 10                                                  |

### Дельта (.delta) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 13px                                                    |
| font-weight            | 400                                                     |
| line-height            | 18.85px                                                 |
| letter-spacing         | normal                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(123, 129, 139)                                      |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | 6px                                                     |
| width                  | 134px                                                   |
| height                 | 22px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  | +5,9 vs 2025-06                                         |

### Іконка в колі (.comp-ic) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(29, 181, 143)                                       |
| background-color       | rgb(220, 243, 235)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(29, 181, 143)                                       |
| border-top-left-radius | 50%                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 32px                                                    |
| height                 | 32px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  |                                                         |

### Рядок участі (.part-row) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | 6px 10px                                                |
| width                  | 480.656px                                               |
| height                 | 46.8438px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Робоча група14 / 15                                     |

### Сегмент смуги участі (.part-row .f) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(155, 224, 122)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 2px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 18.1094px                                               |
| height                 | 20px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  |                                                         |

### Рядок списку (.row) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 10px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 11px                                                    |
| padding-right          | 8px                                                     |
| padding-bottom         | 11px                                                    |
| padding-left           | 8px                                                     |
| gap                    | 12px                                                    |
| width                  | 496.656px                                               |
| height                 | 59.6875px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Аудит системиПідзвітність25,6                           |

### Кнопка основна (.pill-btn.ai-btn) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 500                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(232, 247, 223)                                      |
| border-top-width       | 1px                                                     |
| border-top-color       | rgba(0, 0, 0, 0)                                        |
| border-top-left-radius | 999px                                                   |
| box-shadow             | none                                                    |
| padding-top            | 8px                                                     |
| padding-right          | 14px                                                    |
| padding-bottom         | 8px                                                     |
| padding-left           | 14px                                                    |
| gap                    | 8px                                                     |
| width                  | 118px                                                   |
| height                 | 38.2969px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | Асистент                                                |

### Інпут (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(123, 129, 139)                                      |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 1px                                                     |
| padding-right          | 2px                                                     |
| padding-bottom         | 1px                                                     |
| padding-left           | 2px                                                     |
| gap                    | normal                                                  |
| width                  | 140px                                                   |
| height                 | 22.2969px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  |                                                         |

### Підказка (.tip) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 12px                                                    |
| font-weight            | 600                                                     |
| line-height            | 17.4px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(255, 255, 255)                                      |
| background-color       | rgb(17, 20, 24)                                         |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(255, 255, 255)                                      |
| border-top-left-radius | 9px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 6px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 6px                                                     |
| padding-left           | 10px                                                    |
| gap                    | normal                                                  |
| width                  | 20px                                                    |
| height                 | 12px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  |                                                         |

### Шухляда (.drawer) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(255, 255, 255)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | rgba(0, 0, 0, 0.12) -20px 0px 50px 0px                  |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 460px                                                   |
| height                 | 1080px                                                  |
| _font-variant-numeric  | normal                                                  |
| _text                  |                                                         |

### Тост (.toast) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 500                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(255, 255, 255)                                      |
| background-color       | rgb(17, 20, 24)                                         |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(255, 255, 255)                                      |
| border-top-left-radius | 12px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 10px                                                    |
| padding-right          | 16px                                                    |
| padding-bottom         | 10px                                                    |
| padding-left           | 16px                                                    |
| gap                    | normal                                                  |
| width                  | 32px                                                    |
| height                 | 20px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  |                                                         |

### Рівнева смуга (.levelbar) (маршрут #overview)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | 6px                                                     |
| width                  | 476.812px                                               |
| height                 | 47.9375px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | ПочатковийКерованийВизначенийВ                          |

### _геометрія (маршрут #overview)

| Властивість            | Значення  |
| ---------------------- | --------- |
| ширина сайдбара        | 260       |
| висота верхньої панелі | 74.296875 |

### Кнопка (button) (маршрут #index)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(255, 255, 255)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 14px                                                    |
| padding-right          | 16px                                                    |
| padding-bottom         | 14px                                                    |
| padding-left           | 16px                                                    |
| gap                    | 12px                                                    |
| width                  | 1560px                                                  |
| height                 | 60px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  | Культура                                                |

          63,2вага 33 |

### Заголовок таблиці (th) (маршрут #tracker)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 12px                                                    |
| font-weight            | 500                                                     |
| line-height            | 17.4px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgb(242, 243, 245)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(123, 129, 139)                                      |
| border-top-left-radius | 10px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 10px                                                    |
| padding-right          | 12px                                                    |
| padding-bottom         | 10px                                                    |
| padding-left           | 12px                                                    |
| gap                    | normal                                                  |
| width                  | 63.6719px                                               |
| height                 | 37.3906px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | ID                                                      |

### Комірка таблиці (td) (маршрут #tracker)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 13px                                                    |
| font-weight            | 400                                                     |
| line-height            | 18.85px                                                 |
| letter-spacing         | normal                                                  |
| color                  | rgb(123, 129, 139)                                      |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(123, 129, 139)                                      |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 12px                                                    |
| padding-right          | 12px                                                    |
| padding-bottom         | 12px                                                    |
| padding-left           | 12px                                                    |
| gap                    | normal                                                  |
| width                  | 63.6719px                                               |
| height                 | 60.5px                                                  |
| _font-variant-numeric  | tabular-nums                                            |
| _text                  | T-01                                                    |

### Рядок таблиці (tr) (маршрут #tracker)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 1562px                                                  |
| height                 | 60.5px                                                  |
| _font-variant-numeric  | normal                                                  |
| _text                  | T-01Регулярне навчання з конфл                          |

### Таблиця (маршрут #tracker)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgba(0, 0, 0, 0)                                        |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 0px                                                     |
| box-shadow             | none                                                    |
| padding-top            | 0px                                                     |
| padding-right          | 0px                                                     |
| padding-bottom         | 0px                                                     |
| padding-left           | 0px                                                     |
| gap                    | normal                                                  |
| width                  | 1562px                                                  |
| height                 | 280.391px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | IDЗахідПоказникВідповідальнийС                          |

### Селект (маршрут #tracker)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | normal                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(255, 255, 255)                                      |
| border-top-width       | 1px                                                     |
| border-top-color       | rgb(232, 234, 238)                                      |
| border-top-left-radius | 10px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 7px                                                     |
| padding-right          | 10px                                                    |
| padding-bottom         | 7px                                                     |
| padding-left           | 10px                                                    |
| gap                    | normal                                                  |
| width                  | 190px                                                   |
| height                 | 36px                                                    |
| _font-variant-numeric  | normal                                                  |
| _text                  | ПрийнятоВ роботіВиконаноПростр                          |

### Сегмент-перемикач (маршрут #tracker)

| Властивість            | Значення                                                |
| ---------------------- | ------------------------------------------------------- |
| font-family            | Onest, system-ui, -apple-system, "Segoe UI", sans-serif |
| font-size              | 14px                                                    |
| font-weight            | 400                                                     |
| line-height            | 20.3px                                                  |
| letter-spacing         | normal                                                  |
| color                  | rgb(17, 20, 24)                                         |
| background-color       | rgb(242, 243, 245)                                      |
| border-top-width       | 0px                                                     |
| border-top-color       | rgb(17, 20, 24)                                         |
| border-top-left-radius | 12px                                                    |
| box-shadow             | none                                                    |
| padding-top            | 3px                                                     |
| padding-right          | 3px                                                     |
| padding-bottom         | 3px                                                     |
| padding-left           | 3px                                                     |
| gap                    | 2px                                                     |
| width                  | 328px                                                   |
| height                 | 38.2969px                                               |
| _font-variant-numeric  | normal                                                  |
| _text                  | УсіВ роботіПростроченіВиконані                          |
