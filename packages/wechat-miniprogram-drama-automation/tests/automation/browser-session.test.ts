import assert from "node:assert/strict"
import test from "node:test"

import { isWechatMiniProgramLoginUrl } from "../../src/automation/browser-session.js"

test("does not treat the WeChat portal root as logged out only because token is absent", () => {
  assert.equal(isWechatMiniProgramLoginUrl("https://mp.weixin.qq.com/"), false)
})

test("recognizes explicit WeChat login pages", () => {
  assert.equal(
    isWechatMiniProgramLoginUrl("https://mp.weixin.qq.com/cgi-bin/loginpage?t=wxm2-login"),
    true,
  )
  assert.equal(isWechatMiniProgramLoginUrl("https://mp.weixin.qq.com/login"), true)
})
