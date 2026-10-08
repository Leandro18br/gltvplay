import asyncio, sys; sys.path.insert(0,"/tmp/browser/apis")
from common import *
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b,page=await login(p); errs=[]; page.on("pageerror",lambda e:errs.append(str(e)))
    await page.goto("http://localhost:8080/admin/series"); await page.wait_for_timeout(4000)
    print("menu ep:", await page.get_by_role("link",name="Episódios").count())
    await page.get_by_label("Abrir série").first.click(); await page.wait_for_timeout(3000)
    await page.screenshot(path=str(SS/"11_series.png"))
    g=page.get_by_label("Gerenciar episódios")
    if await g.count(): await g.first.click(); await page.wait_for_timeout(3000)
    await page.screenshot(path=str(SS/"12_season.png")); print(page.url, errs); await b.close()
asyncio.run(main())
