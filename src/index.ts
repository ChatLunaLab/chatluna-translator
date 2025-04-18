/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable max-len */
import { Context, Schema } from 'koishi'

import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { HumanMessagePromptTemplate } from '@langchain/core/prompts'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import Translator from '@koishijs/translator'

// after build, in lib/index.cjs, please add default to Translator
// import_translator.default  -> import_translator.default.default
// fuck js https://github.com/evanw/esbuild/issues/2623
class ChatLunaTranslator extends Translator<ChatLunaTranslator.Config> {
    constructor(ctx: Context, config: ChatLunaTranslator.Config) {
        super(ctx, config)

        ctx.on('chatluna/model-added', (service) => {
            ctx.schema.set('model', Schema.union(this.getModelNames(service)))
        })

        ctx.on('chatluna/model-removed', (service) => {
            ctx.schema.set('model', Schema.union(this.getModelNames(service)))
        })

        ctx.on('ready', () => {
            ctx.schema.set(
                'model',
                Schema.union(this.getModelNames(ctx.chatluna.platform))
            )
        })
    }

    async translate(options?: Translator.Result): Promise<string> {
        const from = options.source || 'auto'
        const to = options.target || 'zh'

        const q = options.input

        const prompt = HumanMessagePromptTemplate.fromTemplate(
            this.config.prompt
        )

        for (let i = 1; i <= 3; i++) {
            try {
                const translated = await this.invoke(prompt, {
                    from,
                    to,
                    text: q
                })

                const matchedJSON = translated.substring(
                    translated.indexOf('{'),
                    translated.lastIndexOf('}') + 1
                )
                return (
                    JSON.parse(matchedJSON) as {
                        result: string
                    }
                ).result
            } catch (e) {
                this.ctx.logger.error(e)
            }
        }

        throw new Error('翻译失败')
    }

    async getModel() {
        const [platform, modelName] = parseRawModelName(this.config.model)

        await this.ctx.chatluna.awaitLoadPlatform(platform)

        return (await this.ctx.chatluna.createChatModel(
            platform,
            modelName
        )) as ChatLunaChatModel
    }

    async invoke(
        prompt: HumanMessagePromptTemplate,
        options: {
            from: string
            to: string
            text: string
        }
    ) {
        const { from, to, text } = options

        const model = await this.getModel()

        const result = await model.invoke([
            ...(await prompt.formatMessages({
                from,
                to,
                text
            }))
        ])

        return result.content as string
    }

    getModelNames(service: PlatformService) {
        return service.getAllModels(ModelType.llm).map((m) => Schema.const(m))
    }
}

export const inject = {
    required: ['chatluna']
}

namespace ChatLunaTranslator {
    export interface Config {
        model: string
        prompt: string
    }

    export const Config = Schema.intersect([
        Schema.object({
            model: Schema.dynamic('model').description('使用的模型'),
            prompt: Schema.string().role('textarea')
                .default(`你是一位专业多语言翻译师，擅长中日英互译，也擅长其他语言的翻译，并且擅长对翻译结果进行二次修改和润色成通俗易懂的目标语言。我希望你能帮我将 {from} 语言的文本翻译成 {to}，而后根据直译结果重新意译和润色。将最后润色的结果输出如下 json 格式：{{"result": "content"}}

规则：
- 这些文本可能包含专业知识和网络术语，注意翻译时术语的准确性和本地化梗。
- 首先第一步按照字面意思直译翻译这一段文本内容；
- 然后基于直译结果重新意译润色，意译时务必对照原始文本，不要添加也不要遗漏内容，并让翻译结果通俗易懂，符合目标语言的表达习惯，保持原文本的人称，不要变动。如果没明确人称（比如 xx 小姐），那就不要在后面增加人称和称呼（xx 小姐后不要加小姐）。对于简洁短小的文本或如 “xx也需要我吗？”不要继续变动。

输出结构：
直译内容：在2023年，我将谈论大型语言模型。为什么我们需要在2023年加上这个后缀呢？
意译内容: {{"result": "2023年，我将谈论大型语言模型。为什么我们需要在这个年份加上这个后缀呢？"}}

以下是我的源语言文本，请直接按例子输出翻译结果：{text}`)
        }).description('基础配置')
    ]) as unknown as Schema<Config>

    export const name = 'chatluna-translator'

    export const inject = ['chatluna']
}

export default ChatLunaTranslator
