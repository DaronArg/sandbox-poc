import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: `
    <h1>Calculadora de precios</h1>
    <label>Precio base: <input id="price" type="number" [(ngModel)]="price"></label><br>
    <label>Descuento (%): <input id="percent" type="number" [(ngModel)]="percent"></label><br>
    <button id="calc" (click)="calculate()">Calcular</button>
    <div id="out" [class.error]="isError()">{{ message() }}</div>
  `,
  styles: [`
    :host { display: block; font-family: sans-serif; max-width: 480px; margin: 3rem auto; }
    input, button { font-size: 1.1rem; margin: .25rem 0; }
    #out { margin-top: 1rem; font-size: 1.4rem; }
    .error { color: #b00020; }
  `],
})
export class App {
  private readonly http = inject(HttpClient);


  protected price = 200;
  protected percent = 25;
  protected readonly message = signal('');
  protected readonly isError = signal(false);

  constructor() {
    this.calculate();
  }

  protected calculate() {
    this.isError.set(false);
    this.message.set('Calculando...');
    this.http
      .get<{ finalPrice: number }>('/api/price', {
        params: { price: this.price, percent: this.percent },
      })
      .subscribe({
        next: (body) => this.message.set(`Precio final: $${body.finalPrice}`),
        error: (e) => {
          this.isError.set(true);
          this.message.set(`Error: ${e.error?.error ?? e.error?.message ?? e.message}`);
        },
      });
  }
}
