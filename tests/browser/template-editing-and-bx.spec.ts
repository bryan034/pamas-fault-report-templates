import {test,expect} from "./checker-fixture";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import type {APIRequestContext, Page} from "@playwright/test";

const api="http://127.0.0.1:8011";
const python=(code:string)=>execFileSync(resolve("backend/.venv/bin/python"),["-c",code],{cwd:resolve("backend")});
const source=()=>python("import sys,runpy;sys.stdout.buffer.write(runpy.run_path('tests/test_templates.py')['sample_pdf']())");
async function seed(request:APIRequestContext, fields?:object[], covers:object[]=[]) {
  const model=JSON.parse(python("import runpy;print(runpy.run_path('tests/test_templates.py')['definition']().model_dump_json())").toString());
  model.ocr_mappings=[];
  model.extractions=[];
  if(fields) {model.fields=fields;model.clear_areas=covers;}
  else model.clear_areas.push({id:"mask",page:0,x:.2,y:.65,width:.12,height:.04,color:"#ffffff"});
  const response=await request.post(`${api}/api/templates`,{multipart:{title:"Editing checks",definition_json:JSON.stringify(model),pdf:{name:"Form.pdf",mimeType:"application/pdf",buffer:source()}}});
  expect(response.status()).toBe(200);
  return response.json();
}

test("clean template preview supports field and cover edits, refreshes and saves their positions",async({page,request})=>{
  const template=await seed(request);
  await page.goto(`/templates/custom/${template.id}/edit`);
  await page.getByRole("button",{name:"View clean template",exact:true}).click();
  await expect(page.getByText("Clean template preview",{exact:true})).toBeVisible();
  const field=page.locator('[data-box-kind="field"][data-box-id="company"]');
  await field.locator("rect").first().click();
  const originalX=Number(await field.locator("rect").first().getAttribute("x"));
  await page.keyboard.press("ArrowRight");
  await expect.poll(async()=>Number(await field.locator("rect").first().getAttribute("x"))).toBeGreaterThan(originalX);
  await expect(page.getByText("Clean template preview",{exact:true})).toBeVisible();
  await expect(page.getByLabel("Font size",{exact:true})).toHaveJSProperty("tagName","SELECT");
  await page.getByLabel("Font size",{exact:true}).selectOption("24");
  await page.getByRole("button",{name:"Only view cover boxes",exact:true}).click();
  const cover=page.locator('[data-box-kind="cover"][data-box-id="mask"]');
  await cover.locator("rect").first().click();
  const originalY=Number(await cover.locator("rect").first().getAttribute("y"));
  const refreshed=page.waitForResponse(response=>response.url().endsWith("/api/templates/review")&&response.request().method()==="POST");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async()=>Number(await cover.locator("rect").first().getAttribute("y"))).toBeGreaterThan(originalY);
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByText("Clean template preview",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Save template",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Template saved successfully"})).toBeVisible();
  const saved=await(await request.get(`${api}/api/templates/${template.id}`)).json();
  expect(saved.definition.fields.find((field:{id:string})=>field.id==="company")).toMatchObject({font_size:24});
  expect(saved.definition.fields.find((field:{id:string})=>field.id==="company").x).toBeGreaterThan(originalX);
  expect(saved.definition.clear_areas.find((cover:{id:string})=>cover.id==="mask").y).toBeGreaterThan(originalY);
});

test("report font selector uses fixed choices, grows a narrow box and persists the chosen size",async({page,request})=>{
  const template=await seed(request,[{id:"text",label:"BX1 temperature",kind:"text",page:0,x:.9,y:.8,width:.04,height:.01,font_size:32,required:false}]);
  await page.goto(`/templates/custom/${template.id}/new`);
  await page.getByLabel("Report title",{exact:true}).fill("Large font");
  await page.getByLabel("BX1 temperature",{exact:true}).fill("42.6");
  // The inherited template size must grow the box before any font override.
  await expect.poll(async()=>Number(await page.locator('[data-field-id="text"] rect').first().getAttribute("height"))).toBeGreaterThan(.04);
  await expect(page.getByLabel("Report font size",{exact:true})).toHaveValue("32");
  const selector=page.getByLabel("Report font size",{exact:true});
  await expect(selector).toHaveJSProperty("tagName","SELECT");
  await selector.selectOption("48");
  await expect.poll(async()=>Number(await page.locator('[data-field-id="text"] rect').first().getAttribute("height"))).toBeGreaterThan(.05);
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  await page.getByRole("button",{name:"Save draft only",exact:true}).click();
  await expect(page).toHaveURL(/\/drafts\//);
  const saved=await(await request.get(`${api}/api/templates/${template.id}/drafts/${page.url().split("/").at(-1)}`)).json();
  expect(saved.form.styles.text.font_size).toBe(48);
  expect(saved.form.layout.text.height).toBeGreaterThan(.05);
  await page.getByLabel("BX1 temperature",{exact:true}).click();
  await selector.selectOption("12");
  await expect(selector).toHaveValue("12");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

async function bxPhoto(page:Page,x:number,y:number,values:string[]) {
  const data=await page.evaluate(({x,y,values})=>{
    const canvas=document.createElement("canvas");canvas.width=900;canvas.height=600;
    const context=canvas.getContext("2d")!;
    context.fillStyle="#222222";context.fillRect(0,0,900,600);
    context.font="bold 38px Arial";context.fillStyle="white";
    values.forEach((value,index)=>context.fillText(`BX${index+1}: ${value} °C`,x,y+index*65));
    return canvas.toDataURL("image/png").split(",")[1];
  },{x,y,values});
  return {name:"Thermal.png",mimeType:"image/png",buffer:Buffer.from(data,"base64")};
}

test("whole-photo OCR fills each nearby BX group, independent of photo text position",async({page,request})=>{
  test.setTimeout(120_000);
  const fields:object[]=[];
  for(const [name,x] of [["Left",.05],["Right",.57]] as const) {
    fields.push({id:name,label:`${name} photo`,kind:"image",page:0,x,y:.08,width:.36,height:.3,required:false});
    for(let index=1;index<=3;index++) fields.push({id:`${name}${index}`,label:`BX${index} ${name}`,kind:"number",page:0,x:x+.05,y:.42+(index-1)*.08,width:.2,height:.04,required:false});
  }
  fields.push({id:"other",label:"BX1 another page",kind:"number",page:1,x:.1,y:.2,width:.2,height:.04,required:false});
  const template=await seed(request,fields);
  await page.goto(`/templates/custom/${template.id}/new`);
  await page.getByLabel("Report title",{exact:true}).fill("BX extraction");
  const section=(name:string)=>page.locator('.template-image-input').filter({has:page.getByRole("heading",{name:`${name} photo`,exact:true})});
  await section("Left").locator('input[type="file"]').setInputFiles(await bxPhoto(page,410,250,["41.0","42.3","43.4"]));
  await section("Left").getByRole("button",{name:"Extract BX values from image",exact:true}).click();
  for(let index=1;index<=3;index++) await expect(page.getByLabel(`BX${index} Left`,{exact:true})).toHaveValue(["41.0","42.3","43.4"][index-1],{timeout:60000});
  await expect(page.getByLabel("BX1 Right",{exact:true})).toHaveValue("");
  await expect(page.getByLabel("BX1 another page",{exact:true})).toHaveValue("");
  await section("Right").locator('input[type="file"]').setInputFiles(await bxPhoto(page,30,70,["61.2","62.3","63.0"]));
  await section("Right").getByRole("button",{name:"Extract BX values from image",exact:true}).click();
  for(let index=1;index<=3;index++) await expect(page.getByLabel(`BX${index} Right`,{exact:true})).toHaveValue(["61.2","62.3","63.0"][index-1],{timeout:60000});
  await expect(page.getByLabel("BX1 Left",{exact:true})).toHaveValue("41.0");
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  await expect(page).toHaveURL(/\/drafts\//);
  const saved=await(await request.get(`${api}/api/templates/${template.id}/drafts/${page.url().split("/").at(-1)}`)).json();
  expect(saved.form.values).toMatchObject({Left1:"41.0",Left2:"42.3",Left3:"43.4",Right1:"61.2",Right2:"62.3",Right3:"63.0"});
});

test("report undo and redo cover focused inputs, formatting, whole drags and annotations",async({page,request})=>{
  const template=await seed(request,[{id:"text",label:"Notes",kind:"textarea",page:0,x:.1,y:.1,width:.3,height:.15,font_size:16,required:false}]);
  await page.goto(`/templates/custom/${template.id}/new`);
  const input=page.getByLabel("Notes",{exact:true});
  await input.fill("First");
  await input.fill("Second");
  await input.press("Control+z");
  await expect(input).toHaveValue("First");
  await input.press("Meta+Shift+z");
  await expect(input).toHaveValue("Second");
  const font=page.getByLabel("Report font size",{exact:true});
  await font.selectOption("32");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(font).toHaveValue("16");
  // Automatic preview layout corrections must not erase the redo stack.
  await expect(page.getByRole("button",{name:"Redo",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  await expect(font).toHaveValue("32");
  const rect=page.locator('[data-field-id="text"] rect').first();
  await expect(page.getByLabel("Rendered value: Notes")).toBeVisible();
  const before=Number(await rect.getAttribute("x"));
  const bounds=(await rect.boundingBox())!;
  await page.mouse.move(bounds.x+10,bounds.y+10);
  await page.mouse.down();
  await page.mouse.move(bounds.x+65,bounds.y+30,{steps:12});
  await page.mouse.up();
  await expect.poll(async()=>Number(await rect.getAttribute("x"))).toBeGreaterThan(before);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect.poll(async()=>Number(await rect.getAttribute("x"))).toBeCloseTo(before,5);
  await page.getByRole("button",{name:"Draw rectangle",exact:true}).click();
  const paper=(await page.getByLabel("Report editing areas, page 1").boundingBox())!;
  await page.mouse.move(paper.x+paper.width*.5,paper.y+paper.height*.5);
  await page.mouse.down();
  await page.mouse.move(paper.x+paper.width*.7,paper.y+paper.height*.6,{steps:12});
  await page.mouse.up();
  await expect(page.locator('[data-shape-id]')).toHaveCount(1);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.locator('[data-shape-id]')).toHaveCount(0);
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  await expect(page.locator('[data-shape-id]')).toHaveCount(1);
  await input.fill("New edit");
  await expect(page.getByRole("button",{name:"Redo",exact:true})).toBeDisabled();
});

test("report undo restores removed photos and a reset; opening a saved draft starts fresh history",async({page,request})=>{
  const template=await seed(request,[{id:"photo",label:"Photo",kind:"image",page:0,x:.1,y:.1,width:.3,height:.3,required:false}]);
  await page.goto(`/templates/custom/${template.id}/new`);
  await page.getByLabel("Report title",{exact:true}).fill("Undo photos");
  const section=page.locator('.template-image-input');
  await section.locator('input[type="file"]').setInputFiles(await bxPhoto(page,30,70,["41.0"]));
  const photo=page.getByAltText("Photo upload",{exact:true});
  await expect(photo).toBeVisible();
  await section.getByRole("button",{name:"Remove",exact:true}).click();
  await expect(photo).toHaveCount(0);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(photo).toBeVisible();
  await page.getByRole("button",{name:"Reset",exact:true}).click();
  await page.getByRole("button",{name:"Reset report",exact:true}).click();
  await expect(photo).toHaveCount(0);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(photo).toBeVisible();
  await expect(page.getByLabel("Report title",{exact:true})).toHaveValue("Undo photos");
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  await expect(page).toHaveURL(/\/drafts\//);
  await page.reload();
  await expect(photo).toBeVisible();
  await expect(page.getByRole("button",{name:"Undo",exact:true})).toBeDisabled();
});

test("template boxes grow around centered labels without enlarging covers; image labels stay normal",async({page,request})=>{
  const fields=[
    {id:"label",label:"Position this label",kind:"text",page:0,x:.1,y:.2,width:.1,height:.01,font_size:32,required:false},
    {id:"number",label:"BX1",kind:"number",page:0,x:.1,y:.4,width:.04,height:.01,font_size:48,required:false},
    {id:"default",label:"Default",default_value:"First\nSecond",kind:"textarea",page:0,x:.4,y:.4,width:.1,height:.01,font_size:24,required:false},
    {id:"roomy",label:"Date",kind:"date",page:0,x:.1,y:.6,width:.4,height:.2,font_size:12,required:false},
    {id:"image",label:"Photo",kind:"image",page:0,x:.6,y:.6,width:.2,height:.15,font_size:16,required:false},
  ];
  const covers=fields.map(field=>({id:field.id,page:field.page,x:field.x,y:field.y,width:field.width,height:field.height,color:"#ffffff"}));
  const template=await seed(request,fields,covers);
  await page.goto(`/templates/custom/${template.id}/edit`);
  const fieldRect=(id:string)=>page.locator(`[data-box-kind="field"][data-box-id="${id}"] > rect`).first();
  const centered=async(id:string)=>{
    const label=page.locator(`[data-template-label="${id}"], [data-template-default="${id}"]`).locator("text");
    await expect(label).toBeVisible();
    await expect.poll(async()=>{
      const text=(await label.boundingBox())!,box=(await fieldRect(id).boundingBox())!;
      return Math.max(Math.abs(text.x+text.width/2-box.x-box.width/2),Math.abs(text.y+text.height/2-box.y-box.height/2));
    }).toBeLessThan(.5);
  };
  for(const clean of [false,true]) {
    if(clean) await page.getByRole("button",{name:"View clean template",exact:true}).click();
    for(const field of fields) {
      await centered(field.id);
      const rect=fieldRect(field.id);
      const cover=page.locator(`[data-box-kind="cover"][data-box-id="${field.id}"] > rect`).first();
      for(const attribute of ["x","y","width","height"] as const)
        expect(Number(await cover.getAttribute(attribute))).toBe(field[attribute]);
      if(["label","number","default"].includes(field.id)) {
        await expect.poll(async()=>Number(await rect.getAttribute("height"))).toBeGreaterThan(field.height);
        await expect(page.locator(`[data-template-label="${field.id}"], [data-template-default="${field.id}"]`).locator("text")).toHaveAttribute("font-size",String(field.font_size));
      } else {
        expect(Number(await rect.getAttribute("width"))).toBe(field.width);
        expect(Number(await rect.getAttribute("height"))).toBe(field.height);
      }
    }
  }
  await fieldRect("number").click();
  await page.getByLabel("Font size",{exact:true}).selectOption("72");
  await centered("number");
  await expect(page.locator('[data-template-label="number"] text')).toHaveAttribute("font-size","72");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.locator('[data-template-label="number"] text')).toHaveAttribute("font-size","48");
  await page.getByRole("button",{name:"Save template",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Template saved successfully"})).toBeVisible();
  const saved=await(await request.get(`${api}/api/templates/${template.id}`)).json();
  expect(saved.definition.clear_areas).toEqual(covers);
  expect(saved.definition.fields.find((field:{id:string})=>field.id==="number").height).toBeGreaterThan(.01);
});


test("moving template inputs detaches stationary covers across drag, keyboard, groups, undo and saving",async({page,request})=>{
  const fields=[
    {id:"one",label:"Name",kind:"text",page:0,x:.1,y:.2,width:.2,height:.08,font_size:16,required:false},
    {id:"two",label:"BX1",kind:"number",page:0,x:.5,y:.2,width:.2,height:.08,font_size:16,required:false},
  ];
  const covers=fields.map(field=>({id:field.id,page:field.page,x:field.x,y:field.y,width:field.width,height:field.height,color:"#ffffff"}));
  const template=await seed(request,fields,covers);
  await page.goto(`/templates/custom/${template.id}/edit`);
  const layer=page.getByLabel("Template field review, page 1",{exact:true});
  const rect=(id:string)=>layer.locator(`[data-box-kind="field"][data-box-id="${id}"] > rect`).first();
  const coverGeometry=()=>layer.locator('[data-box-kind="cover"] > rect').evaluateAll(nodes=>
    nodes.map(node=>["x","y","width","height"].map(key=>node.getAttribute(key))));
  await expect(layer.locator('[data-box-kind="cover"]')).toHaveCount(2);
  const original=await coverGeometry();
  const bounds=(await rect("one").boundingBox())!;
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2+35,bounds.y+bounds.height/2+20,{steps:8});
  await page.mouse.up();
  await expect.poll(async()=>Number(await rect("one").getAttribute("x"))).toBeGreaterThan(.1);
  expect(await coverGeometry()).toEqual(original);
  await expect(layer.locator('[data-box-kind="cover"][data-box-id="one"]')).toHaveCount(0);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(layer.locator('[data-box-kind="cover"][data-box-id="one"]')).toHaveCount(1);
  await page.getByRole("button",{name:"Redo",exact:true}).click();
  expect(await coverGeometry()).toEqual(original);
  await layer.focus();
  await page.keyboard.press("ArrowRight");
  expect(await coverGeometry()).toEqual(original);
  await rect("one").click();
  await rect("two").click({modifiers:["Control"]});
  await layer.focus();
  await page.keyboard.press("ArrowDown");
  expect(await coverGeometry()).toEqual(original);
  await expect(layer.locator('[data-box-kind="cover"][data-box-id="two"]')).toHaveCount(0);
  await page.getByRole("button",{name:"Save template",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Template saved successfully"})).toBeVisible();
  const saved=await(await request.get(`${api}/api/templates/${template.id}`)).json();
  expect(saved.definition.clear_areas).toEqual(covers.map(cover=>({...cover,id:expect.any(String)})));
  expect(saved.definition.clear_areas.every((cover:{id:string})=>!["one","two"].includes(cover.id))).toBe(true);
  await page.goto(`/templates/custom/${template.id}/edit`);
  await rect("one").click();
  await layer.focus();
  await page.keyboard.press("Delete");
  await expect(rect("one")).toHaveCount(0);
  expect(await coverGeometry()).toEqual(original);
});
