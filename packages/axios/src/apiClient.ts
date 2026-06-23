import type { AxiosInstance, AxiosResponse, CreateAxiosDefaults } from "axios";

import axios, { type AxiosRequestConfig } from "axios";

import type { RequestInterceptorRegistrar, ResponseInterceptorRegistrar } from "./clientTypes.js";

class ApiClient {
  private readonly instance: AxiosInstance;

  public readonly addRequestInterceptor: RequestInterceptorRegistrar;
  public readonly addResponseInterceptor: ResponseInterceptorRegistrar;

  constructor(config: CreateAxiosDefaults) {
    this.instance = axios.create({ ...config });

    this.addRequestInterceptor = this.instance.interceptors.request.use.bind(
      this.instance.interceptors.request,
    );
    this.addResponseInterceptor = this.instance.interceptors.response.use.bind(
      this.instance.interceptors.response,
    );
  }

  private unwrapData<T>(promise: Promise<AxiosResponse<T>>): Promise<T> {
    return promise.then((response) => {
      return response.data;
    });
  }

  public request<T = unknown, D = unknown>(config: AxiosRequestConfig): Promise<T> {
    return this.unwrapData(this.instance.request<T, AxiosResponse<T>, D>(config));
  }

  public get<T = unknown, D = unknown>(url: string, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.get<T, AxiosResponse<T>, D>(url, config));
  }

  public delete<T = unknown, D = unknown>(url: string, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.delete<T, AxiosResponse<T>, D>(url, config));
  }

  public head<T = unknown, D = unknown>(url: string, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.head<T, AxiosResponse<T>, D>(url, config));
  }

  public options<T = unknown, D = unknown>(url: string, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.options<T, AxiosResponse<T>, D>(url, config));
  }

  public post<T = unknown, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.post<T, AxiosResponse<T>, D>(url, data, config));
  }

  public put<T = unknown, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.put<T, AxiosResponse<T>, D>(url, data, config));
  }

  public patch<T = unknown, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.patch<T, AxiosResponse<T>, D>(url, data, config));
  }

  public postForm<T = unknown, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.postForm<T, AxiosResponse<T>, D>(url, data, config));
  }

  public putForm<T = unknown, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) {
    return this.unwrapData(this.instance.putForm<T, AxiosResponse<T>, D>(url, data, config));
  }

  public patchForm<T = unknown, D = unknown>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D>,
  ) {
    return this.unwrapData(this.instance.patchForm<T, AxiosResponse<T>, D>(url, data, config));
  }

  public getInstance(): AxiosInstance {
    return this.instance;
  }
}

export { ApiClient };
