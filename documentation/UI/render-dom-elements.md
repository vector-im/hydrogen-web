tldr; Use `tag` from `ui/general/html.js` to quickly create DOM elements.

## Syntax
---
The general syntax is as follows:
```js
tag.tag_name({attribute1: value, attribute2: value, ...}, [child_elements]);
```
**tag_name** can be any one of the following:
```
    br, a, ol, ul, li, div, h1, h2, h3, h4, h5, h6,
    p, strong, em, span, img, section, main, article, aside,
    pre, button, time, input, textarea, label, form, progress, output, video
```

<br />

eg:
Here is an example HTML segment followed with the code to create it in Hydrogen.
```html
<section class="main-section">
    <h1>Demo</h1>
    <button class="btn_cool">Click me</button>
</section>
```
```js
tag.section({className: "main-section"},[
    tag.h1("Demo"), 
    tag.button({className:"btn_cool"}, "Click me")
    ]);
```
<br />

**Note:** In views based on `TemplateView`, you will see `t` used instead of `tag`.  
`t` is is `TemplateBuilder` object passed to the render function in `TemplateView`.
Although syntactically similar, they are not functionally equivalent.  
Primarily `t` **supports** bindings and event handlers while `tag` **does not**.

```js
    // The onClick here wont work!!
    tag.button({className:"awesome-btn", onClick: () => this.foo()});

    render(t, vm){
        // The onClick works here.
        t.button({className:"awesome-btn", onClick: () => this.foo()});
    }
```
