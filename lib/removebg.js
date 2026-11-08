const axios = require("axios");
const crypto = require("crypto");
const FormData = require("form-data");

async function removebg(input) {
    const config = { pkey: "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlHZk1BMEdDU3FHU0liM0RRRUJBUVVBQTRHTkFEQ0JpUUtCZ1FDd2xPK2JvQzZjd1JvM1VmWFZCYWRhWXdjWDB6S1MyZnVWTlkycVowZGd3YjFOSisvUTlGZUFvc0w0T05pb3NENzFvbjNQVllxUlVsTDUwNDVtdkgySzlpOGJBRlZNRWlwN0U2Uk1LNnRLQUFpZjd4elpyWG5QMUdaNVJpanRxZGd3aCtZbXpUbzM5Y3VCQ3NacUs5b0VvZVEzci9teUc5Uys5Y1I1aHVUdUZRSURBUUFCCi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQ==", aid: "aifaceswap", uid: "1H5tRtzsBkqXcaJ", origin: "8f3f0c7387123ae0", theme_version: "83EmcUoQTUv50LhNx0VrdcK8rcGexcP35FcZDcpgWsAXEyO4xqL5shCY6sFIWB2Q" };
    let buffer;
    let contentType;
    if (Buffer.isBuffer(input)) {
        buffer = input;
        contentType = "image/jpeg";
    } else if (typeof input === "string") {
        const res = await axios.get(input, { responseType: "arraybuffer" });
        buffer = Buffer.from(res.data);
        contentType = res.headers["content-type"] || "image/jpeg";
    } else {
        throw new Error("Input must be a Buffer or an image URL (string).");
    }
    const currentFp = crypto.randomBytes(16).toString("hex");
    const crypt = {
        aes: (data, key) => {
            const cipher = crypto.createCipheriv("aes-128-cbc", key, key);
            return Buffer.concat([cipher.update(data, "utf8"), cipher.final()]).toString("base64");
        },
        rsa: (data) => {
            return crypto.publicEncrypt({ key: Buffer.from(config.pkey, "base64").toString(), padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(data, "utf8")).toString("base64");
        }
    };
    const api = axios.create({ baseURL: "https://app-v1.live3d.io", headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 16; NX729J) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.34 Mobile Safari/537.36", origin: "https://live3d.io", referer: "https://live3d.io/", "theme-version": config.theme_version, "Brand-Key": config.origin } });
    api.interceptors.request.use(cfg => {
        const [i, d, n] = [crypto.randomBytes(8).toString("hex"), crypto.randomUUID(), Math.floor(Date.now() / 1000)];
        const s = crypt.rsa(i);
        const signStr = cfg.url.includes("upload-img") ? `${config.aid}:${d}:${s}` : `${config.aid}:${config.uid}:${n}:${d}:${s};`;
        Object.assign(cfg.headers, { fp: currentFp, fp1: crypt.aes(`${config.aid}:${currentFp}`, i), "x-guide": s, "x-sign": crypt.aes(signStr, i), "x-code": Date.now().toString(), nonce: "remove-bg" });
        return cfg;
    });

    try {
        const form = new FormData();
        form.append("file", buffer, { filename: "input.jpg", contentType });
        form.append("fn_name", "remove-bg");
        form.append("request_from", "9");
        form.append("origin_from", config.origin);
        const { data: upRes } = await api.post("/aitools/upload-img", form, { headers: form.getHeaders() });
        if (!upRes?.data?.path) throw new Error("Failed to upload the image to the AI server.");
        const { data: job } = await api.post("/aitools/of/create", { fn_name: "remove-bg", call_type: 3, input: { source_image: upRes.data.path, request_from: 9 }, data: "", request_from: 9, origin_from: config.origin });
        const taskId = job?.data?.task_id;
        if (!taskId) throw new Error(`AI task ID not found (${job?.code}: ${job?.message || job?.detail || "unknown"}).`);
        let attempts = 0;
        while (attempts < 120) {
            attempts++;
            const { data: status } = await api.post("/aitools/of/check-status", { task_id: taskId, fn_name: "remove-bg", call_type: 3, request_from: 9, origin_from: config.origin });
            if (status?.data?.status === 2 && status?.data?.result_image) {
                const image = await axios.get("https://temp.live3d.io/" + status.data.result_image, { responseType: "arraybuffer", timeout: 30000 });
                return Buffer.from(image.data);
            }
            if (status?.data?.status === 3) throw new Error(status.data?.msg || "AI Image Upscaler failed to process the image.");
            await new Promise(r => setTimeout(r, 3000));
        }
        throw new Error("Proses AI Image Upscaler timeout.");
    } catch (error) {
        const status = error.response?.status;
        const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
        throw new Error(`Process failed at ${error.config?.url} (${status}): ${detail}`);
    }
}

module.exports = { removebg }
