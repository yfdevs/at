import type { Axios } from "axios";

type AxiosInterceptors = Axios["interceptors"];
type RequestInterceptors = AxiosInterceptors["request"];
type ResponseInterceptors = AxiosInterceptors["response"];

export type RequestInterceptorRegistrar = RequestInterceptors["use"];
export type ResponseInterceptorRegistrar = ResponseInterceptors["use"];
