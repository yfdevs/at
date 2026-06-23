import { type AxiosError, type InternalAxiosRequestConfig } from "axios";

export const attachAuthTokenHeader = async (
  value: InternalAxiosRequestConfig,
  storageTokenKey: string = "token",
) => {
  const token = localStorage.getItem(storageTokenKey);
  if (token) {
    value.headers.Authorization = `Bearer ${token}`;
  }
  return value;
};

export const handleRequestError = (error: AxiosError) => {
  return Promise.reject(error);
};
