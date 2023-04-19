import { assign, chunk } from 'lodash'
import moment from 'moment'

const aliyun = require('aliyun-sdk')
declare interface Options {
    access: string
    secret: string
    endpoint: string
    version: string
    timeout: number
    project: string
    storage: string
    batch: number
    interval: number
    topic: string
    content: any
}

declare interface LogContent {
    startTime: Date
    categoryName: string
    data: [string, any]
    level: {
        level: number
        levelStr: string
    }
    pid: number
}

let slsclient: any
let config: Options | undefined
let caches: any[] = []
let interval: NodeJS.Timeout | undefined

function post2sls(content: LogContent) {
    if (!slsclient || !config) {
        return
    }
    const logbody = content.data[1]
    if (typeof logbody !== 'object') {
        return
    }

    logbody._message = content.data[0]
    logbody._category = content.categoryName
    logbody._level = content.level.levelStr
    logbody._timestamp = content.startTime
    config.content && assign(logbody, config.content)

    const contents = []
    for (let i in logbody) {
        if (logbody[i] !== null && logbody[i] !== undefined) {
            contents.push({ key: i, value: typeof logbody[i] === 'object' ? JSON.stringify(logbody[i]) : logbody[i].toString() })
        }
    }
    if (config.interval) {
        caches.push({
            time: moment(content.startTime).unix(),
            contents
        })

        if (!interval) {
            const batch = config.batch || 20
            interval = setInterval(() => {
                if (caches.length) {
                    const batches = chunk(caches, batch)
                    caches = []
                    batches.forEach((item) => {
                        sendbatch(item)
                    })
                }
            }, config.interval)
        }
        return
    }
    sendbatch([
        {
            time: moment(content.startTime).unix(),
            contents
        }
    ])
}

function sendbatch(logs: any[]) {
    if (!config || !slsclient.putLogs) return

    slsclient.putLogs(
        {
            projectName: config.project,
            logStoreName: config.storage,
            logGroup: {
                logs
            }
        },
        (err: Error) => {
            if (err) {
                console.error('send log failed: ', err.message)
            }
        }
    )
}

export function configure(opts: Options) {
    config = opts

    const params: any = {
        accessKeyId: config.access,
        secretAccessKey: config.secret,
        endpoint: config.endpoint,
        apiVersion: config.version
    }

    if (params.timeout) {
        params.httpOptions = {
            timeout: config.timeout
        }
    }
    slsclient = new aliyun.SLS(params)
    return post2sls
}
